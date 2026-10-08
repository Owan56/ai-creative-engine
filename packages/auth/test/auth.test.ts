/**
 * Tests d'authentification et d'autorisation, contre un vrai PostgreSQL.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  AssetAccess,
  AuthError,
  AuthService,
  NotFoundError,
  WeakPasswordError,
  buildStorageKey,
  detectImageType,
  hashPassword,
  signAssetUrl,
  verifyPassword,
  verifySignedUrl,
  type AuthUser,
} from "../src/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const decrire = DATABASE_URL ? describe : describe.skip;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const auth = new AuthService(pool);
const assets = new AssetAccess(pool);

const MDP = "un-mot-de-passe-assez-long";

afterAll(async () => {
  await pool.end().catch(() => {});
});

async function nouvelUtilisateur(): Promise<AuthUser> {
  return auth.signUp({
    email: `u-${crypto.randomUUID()}@example.invalid`,
    password: MDP,
  });
}

describe("hachage de mot de passe", () => {
  it("ne produit jamais deux fois la même empreinte", async () => {
    const a = await hashPassword(MDP);
    const b = await hashPassword(MDP);
    // Sels distincts : une table précalculée ne sert à rien.
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it("vérifie le bon mot de passe et rejette les autres", async () => {
    const stocke = await hashPassword(MDP);
    expect(await verifyPassword(MDP, stocke)).toBe(true);
    expect(await verifyPassword(MDP + "x", stocke)).toBe(false);
    expect(await verifyPassword("", stocke)).toBe(false);
  });

  it("refuse un mot de passe trop court", async () => {
    await expect(hashPassword("court")).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it("ne plante pas sur une empreinte stockée corrompue", async () => {
    expect(
      await verifyPassword(MDP, { hash: "pas-du-base64-valide!!", salt: "xx" }),
    ).toBe(false);
  });
});

describe("validation d'upload (§64)", () => {
  it("reconnaît le type réel d'après les premiers octets", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(jpeg)).toBe("image/jpeg");
  });

  it("rejette un exécutable déguisé en image", () => {
    // Un ELF renommé « produit.png » : l'extension ment, pas les octets.
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(detectImageType(elf)).toBeNull();
  });

  it("ne réutilise jamais le nom de fichier fourni", () => {
    const cle = buildStorageKey("user-1", "PRODUCT_IMAGE", "../../etc/passwd");
    expect(cle).not.toContain("..");
    expect(cle).not.toContain("passwd");
    expect(cle.startsWith("user-1/product_image/")).toBe(true);
  });

  it("produit une clé différente à chaque appel", () => {
    const a = buildStorageKey("user-1", "VIDEO", "mp4");
    const b = buildStorageKey("user-1", "VIDEO", "mp4");
    expect(a).not.toBe(b);
  });
});

describe("URL signées (§85)", () => {
  const SECRET = "secret-de-test";

  it("accepte une URL fraîche et refuse une URL expirée", () => {
    const signee = signAssetUrl(SECRET, "u/1/video.mp4", 300);
    expect(verifySignedUrl(SECRET, signee)).toBe(true);
    expect(verifySignedUrl(SECRET, signee, signee.expiresAt + 1)).toBe(false);
  });

  it("refuse une signature réutilisée pour un autre fichier", () => {
    const signee = signAssetUrl(SECRET, "u/1/a.mp4", 300);
    expect(
      verifySignedUrl(SECRET, { ...signee, storageKey: "u/2/b.mp4" }),
    ).toBe(false);
  });

  it("refuse une expiration repoussée à la main", () => {
    const signee = signAssetUrl(SECRET, "u/1/a.mp4", 1);
    expect(
      verifySignedUrl(SECRET, { ...signee, expiresAt: signee.expiresAt + 99999 }),
    ).toBe(false);
  });

  it("refuse une signature produite avec un autre secret", () => {
    const signee = signAssetUrl("autre-secret", "u/1/a.mp4", 300);
    expect(verifySignedUrl(SECRET, signee)).toBe(false);
  });

  it("ne plante pas sur une signature malformée", () => {
    const signee = signAssetUrl(SECRET, "u/1/a.mp4", 300);
    expect(verifySignedUrl(SECRET, { ...signee, signature: "zz" })).toBe(false);
    expect(verifySignedUrl(SECRET, { ...signee, signature: "" })).toBe(false);
  });
});

decrire("AuthService", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
  });

  it("crée un compte avec son compte de crédits", async () => {
    const user = await nouvelUtilisateur();
    const { rows } = await pool.query(
      `SELECT 1 FROM credit_accounts WHERE user_id = $1`,
      [user.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("ne stocke jamais le mot de passe en clair", async () => {
    const user = await nouvelUtilisateur();
    const { rows } = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [user.id],
    );
    expect(rows[0]!.password_hash).not.toContain(MDP);
  });

  it("refuse deux comptes sur la même adresse, casse comprise", async () => {
    const email = `dup-${crypto.randomUUID()}@example.invalid`;
    await auth.signUp({ email, password: MDP });
    await expect(
      auth.signUp({ email: email.toUpperCase(), password: MDP }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("donne la même erreur pour un compte inconnu et un mauvais mot de passe", async () => {
    const user = await nouvelUtilisateur();

    const inconnu = await auth
      .signIn("personne@example.invalid", MDP)
      .catch((e) => e);
    const mauvais = await auth.signIn(user.email, "mauvais-mot-de-passe").catch((e) => e);

    // Distinguer les deux permettrait d'énumérer les comptes existants.
    expect(inconnu).toBeInstanceOf(AuthError);
    expect(mauvais).toBeInstanceOf(AuthError);
    expect(inconnu.code).toBe(mauvais.code);
    expect(inconnu.message).toBe(mauvais.message);
  });

  it("ne stocke jamais le jeton de session en clair", async () => {
    const user = await nouvelUtilisateur();
    const { session } = await auth.signIn(user.email, MDP);

    const { rows } = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM sessions WHERE user_id = $1`,
      [user.id],
    );
    // Une fuite de la table ne doit pas livrer de sessions utilisables.
    expect(rows[0]!.token_hash).not.toBe(session.token);

    const { rows: aucun } = await pool.query(
      `SELECT 1 FROM sessions WHERE token_hash = $1`,
      [session.token],
    );
    expect(aucun).toHaveLength(0);
  });

  it("résout une session valide et rejette un jeton inventé", async () => {
    const user = await nouvelUtilisateur();
    const { session } = await auth.signIn(user.email, MDP);

    expect(await auth.resolveSession(session.token)).toMatchObject({ id: user.id });
    expect(await auth.resolveSession("jeton-invente")).toBeNull();
    expect(await auth.resolveSession("")).toBeNull();
  });

  it("invalide une session révoquée", async () => {
    const user = await nouvelUtilisateur();
    const { session } = await auth.signIn(user.email, MDP);

    await auth.revokeSession(session.token);
    expect(await auth.resolveSession(session.token)).toBeNull();
  });

  it("invalide une session expirée", async () => {
    const user = await nouvelUtilisateur();
    const session = await auth.createSession(user.id);

    await pool.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [session.id],
    );
    expect(await auth.resolveSession(session.token)).toBeNull();
  });

  it("expulse toutes les sessions au changement de mot de passe", async () => {
    const user = await nouvelUtilisateur();
    const a = await auth.createSession(user.id);
    const b = await auth.createSession(user.id);

    await auth.changePassword(user.id, "un-nouveau-mot-de-passe-long");

    // C'est tout l'intérêt de l'opération quand le compte est compromis.
    expect(await auth.resolveSession(a.token)).toBeNull();
    expect(await auth.resolveSession(b.token)).toBeNull();
    await expect(auth.signIn(user.email, MDP)).rejects.toBeInstanceOf(AuthError);
    await expect(
      auth.signIn(user.email, "un-nouveau-mot-de-passe-long"),
    ).resolves.toBeTruthy();
  });
});

decrire("AssetAccess — cloisonnement entre comptes (§108)", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
  });

  async function deuxComptesAvecActif() {
    const alice = await nouvelUtilisateur();
    const bob = await nouvelUtilisateur();
    const actifAlice = await assets.create(alice, {
      kind: "PRODUCT_IMAGE",
      storageKey: buildStorageKey(alice.id, "PRODUCT_IMAGE", "png"),
      contentType: "image/png",
      sizeBytes: 1024,
    });
    return { alice, bob, actifAlice };
  }

  it("Bob ne peut pas lire le fichier d'Alice", async () => {
    const { bob, actifAlice } = await deuxComptesAvecActif();

    // 404 et non 403 : un 403 confirmerait que l'identifiant existe.
    await expect(assets.get(bob, actifAlice.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("Bob ne voit pas les fichiers d'Alice dans sa liste", async () => {
    const { bob, actifAlice } = await deuxComptesAvecActif();

    const listeBob = await assets.listForUser(bob);
    expect(listeBob.map((a) => a.id)).not.toContain(actifAlice.id);
    expect(listeBob).toHaveLength(0);
  });

  it("Bob ne peut pas supprimer le fichier d'Alice", async () => {
    const { alice, bob, actifAlice } = await deuxComptesAvecActif();

    await expect(assets.softDelete(bob, actifAlice.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Le fichier d'Alice est intact.
    await expect(assets.get(alice, actifAlice.id)).resolves.toMatchObject({
      id: actifAlice.id,
    });
  });

  it("Bob ne peut pas déposer un fichier dans le projet d'Alice", async () => {
    const { alice, bob } = await deuxComptesAvecActif();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO projects (user_id, name) VALUES ($1, 'Projet Alice') RETURNING id`,
      [alice.id],
    );

    await expect(
      assets.create(bob, {
        kind: "VIDEO",
        storageKey: buildStorageKey(bob.id, "VIDEO", "mp4"),
        contentType: "video/mp4",
        sizeBytes: 10,
        projectId: rows[0]!.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Alice accède bien à son propre fichier", async () => {
    const { alice, actifAlice } = await deuxComptesAvecActif();
    await expect(assets.get(alice, actifAlice.id)).resolves.toMatchObject({
      id: actifAlice.id,
      userId: alice.id,
    });
  });

  it("un administrateur accède aux fichiers, un utilisateur jamais", async () => {
    const { alice, bob, actifAlice } = await deuxComptesAvecActif();

    const admin = { ...bob, role: "ADMIN" as const };
    await expect(assets.get(admin, actifAlice.id)).resolves.toMatchObject({
      userId: alice.id,
    });
    // Le même compte sans le rôle reste exclu : c'est bien le rôle qui décide.
    await expect(assets.get(bob, actifAlice.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("un actif supprimé n'est plus lisible, même par son propriétaire", async () => {
    const { alice, actifAlice } = await deuxComptesAvecActif();
    await assets.softDelete(alice, actifAlice.id);
    await expect(assets.get(alice, actifAlice.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
