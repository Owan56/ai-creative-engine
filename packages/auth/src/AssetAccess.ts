/**
 * Accès aux actifs, borné par la propriété (cahier des charges §63, §85, §108).
 *
 * Règle non négociable : un utilisateur ne doit jamais atteindre le fichier
 * d'un autre. Elle est appliquée ici, dans la couche d'accès, et pas dans
 * chaque route — une route qu'on oublie de protéger est une fuite, une
 * couche d'accès qui filtre par défaut ne s'oublie pas.
 *
 * Toute méthode prend l'utilisateur appelant en premier argument. Il n'existe
 * aucune méthode « par identifiant seul » : c'est volontaire, pour qu'on ne
 * puisse pas l'appeler par mégarde depuis une route authentifiée.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { AuthUser } from "./AuthService.js";

export type AssetKind =
  | "PRODUCT_IMAGE"
  | "VIDEO"
  | "THUMBNAIL"
  | "AUDIO"
  | "EXPORT";

export interface Asset {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string | null;
  readonly kind: AssetKind;
  readonly storageKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Accès refusé.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Ressource introuvable.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Types acceptés à l'upload (§7). La liste est blanche, jamais noire. */
export const TYPES_IMAGE_AUTORISES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/**
 * Signatures de fichier. On ne fait jamais confiance à l'extension ni à
 * l'en-tête `Content-Type` déclaré par le client (§64) : seuls les premiers
 * octets disent ce qu'est vraiment le fichier.
 */
const SIGNATURES: ReadonlyArray<{
  readonly contentType: string;
  readonly test: (b: Buffer) => boolean;
}> = [
  {
    contentType: "image/jpeg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    contentType: "image/png",
    test: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
  },
  {
    contentType: "image/webp",
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/** Renvoie le type réel d'après le contenu, ou null si non reconnu. */
export function detectImageType(bytes: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(bytes))?.contentType ?? null;
}

/**
 * Fabrique une clé de stockage interne.
 *
 * Le nom fourni par l'utilisateur n'est jamais réutilisé : il pourrait
 * contenir `../`, un octet nul, ou entrer en collision avec un autre fichier.
 */
export function buildStorageKey(
  userId: string,
  kind: AssetKind,
  extension: string,
): string {
  const ext = extension.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8);
  return `${userId}/${kind.toLowerCase()}/${randomBytes(16).toString("hex")}${
    ext ? `.${ext}` : ""
  }`;
}

export interface CreateAssetInput {
  readonly kind: AssetKind;
  readonly storageKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly projectId?: string;
  readonly sha256?: string;
}

export class AssetAccess {
  constructor(private readonly pool: Pool) {}

  async create(caller: AuthUser, input: CreateAssetInput): Promise<Asset> {
    // Rattacher l'actif à un projet exige de posséder ce projet : sinon on
    // pourrait déposer des fichiers dans l'espace d'autrui.
    if (input.projectId) await this.assertOwnsProject(caller, input.projectId);

    const { rows } = await this.pool.query<AssetRow>(
      `INSERT INTO assets
         (user_id, project_id, kind, storage_key, content_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, project_id, kind, storage_key, content_type, size_bytes`,
      [
        caller.id,
        input.projectId ?? null,
        input.kind,
        input.storageKey,
        input.contentType,
        input.sizeBytes,
        input.sha256 ?? null,
      ],
    );
    return mapAsset(rows[0]!);
  }

  /**
   * Lit un actif au nom d'un utilisateur.
   *
   * L'actif d'autrui renvoie 404, pas 403 : un 403 confirmerait que
   * l'identifiant existe, ce qui permet de sonder le catalogue.
   */
  async get(caller: AuthUser, assetId: string): Promise<Asset> {
    const { rows } = await this.pool.query<AssetRow>(
      `SELECT id, user_id, project_id, kind, storage_key, content_type, size_bytes
         FROM assets
        WHERE id = $1 AND deleted_at IS NULL`,
      [assetId],
    );

    const row = rows[0];
    if (!row) throw new NotFoundError();

    if (row.user_id !== caller.id && caller.role !== "ADMIN") {
      throw new NotFoundError();
    }
    return mapAsset(row);
  }

  async listForUser(caller: AuthUser, limit = 50): Promise<Asset[]> {
    const { rows } = await this.pool.query<AssetRow>(
      `SELECT id, user_id, project_id, kind, storage_key, content_type, size_bytes
         FROM assets
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2`,
      [caller.id, Math.min(Math.max(limit, 1), 200)],
    );
    return rows.map(mapAsset);
  }

  async softDelete(caller: AuthUser, assetId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE assets SET deleted_at = now()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [assetId, caller.id],
    );
    if (!rowCount) throw new NotFoundError();
  }

  private async assertOwnsProject(
    caller: AuthUser,
    projectId: string,
  ): Promise<void> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM projects WHERE id = $1`,
      [projectId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Projet introuvable.");
    if (row.user_id !== caller.id && caller.role !== "ADMIN") {
      throw new NotFoundError("Projet introuvable.");
    }
  }
}

// ---------------------------------------------------------------- URL signées

/**
 * URL temporaires pour servir un actif privé (§85).
 *
 * Les actifs ne sont jamais publics. Un lien signé porte sa propre expiration
 * et ne vaut que pour une clé de stockage donnée.
 */
export interface SignedUrl {
  readonly storageKey: string;
  readonly expiresAt: number;
  readonly signature: string;
}

export function signAssetUrl(
  secret: string,
  storageKey: string,
  ttlSeconds = 300,
): SignedUrl {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { storageKey, expiresAt, signature: sign(secret, storageKey, expiresAt) };
}

export function verifySignedUrl(
  secret: string,
  signed: SignedUrl,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (signed.expiresAt <= now) return false;

  const attendue = Buffer.from(
    sign(secret, signed.storageKey, signed.expiresAt),
    "hex",
  );
  let fournie: Buffer;
  try {
    fournie = Buffer.from(signed.signature, "hex");
  } catch {
    return false;
  }
  // Longueurs différentes : timingSafeEqual lèverait, donc on tranche avant.
  if (fournie.length !== attendue.length) return false;
  return timingSafeEqual(fournie, attendue);
}

function sign(secret: string, storageKey: string, expiresAt: number): string {
  return createHash("sha256")
    .update(`${secret}\u0000${storageKey}\u0000${expiresAt}`)
    .digest("hex");
}

// ---------------------------------------------------------------- interne

interface AssetRow {
  id: string;
  user_id: string;
  project_id: string | null;
  kind: AssetKind;
  storage_key: string;
  content_type: string;
  size_bytes: string | number;
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    kind: row.kind,
    storageKey: row.storage_key,
    contentType: row.content_type,
    // `bigint` revient en chaîne depuis pg : convertir explicitement.
    sizeBytes: Number(row.size_bytes),
  };
}
