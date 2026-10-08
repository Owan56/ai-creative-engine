/**
 * Authentification par session (cahier des charges §63).
 *
 * Choix : jetons opaques en base plutôt que JWT. Un JWT ne se révoque pas
 * sans liste noire — ce qui revient à consulter la base de toute façon, mais
 * en plus compliqué. Ici, révoquer une session est une écriture.
 *
 * Le jeton n'est jamais stocké : la base ne garde que son empreinte SHA-256.
 * Une fuite de la table `sessions` ne permet donc pas d'usurper un compte.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
  type HashedPassword,
} from "./password.js";

export type Role = "USER" | "ADMIN";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
}

export interface Session {
  readonly id: string;
  readonly userId: string;
  /** Jeton en clair — renvoyé une seule fois, à la création. */
  readonly token: string;
  readonly expiresAt: Date;
}

export type AuthErrorCode =
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_SESSION"
  | "WEAK_PASSWORD";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const TOKEN_BYTES = 32;
const DEFAULT_SESSION_DAYS = 30;

/** Empreinte du jeton. SHA-256 suffit : le jeton est déjà à haute entropie. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export interface SessionContext {
  userAgent?: string;
  ip?: string;
  /** Durée de vie de la session, en jours. */
  lifetimeDays?: number;
}

export class AuthService {
  constructor(private readonly pool: Pool) {}

  async signUp(input: SignUpInput): Promise<AuthUser> {
    const email = normaliserEmail(input.email);
    assertPasswordAcceptable(input.password);

    const { hash, salt } = await hashPassword(input.password);

    try {
      const { rows } = await this.pool.query<AuthUser & { role: Role }>(
        `INSERT INTO users (email, name, password_hash, password_salt)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, role`,
        [email, input.name ?? null, hash, salt],
      );
      const user = rows[0]!;
      await this.pool.query(
        `INSERT INTO credit_accounts (user_id) VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
      return user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AuthError("EMAIL_TAKEN", "Cette adresse est déjà utilisée.");
      }
      throw err;
    }
  }

  /**
   * Vérifie les identifiants.
   *
   * Un email inconnu et un mot de passe faux renvoient la même erreur : dire
   * lequel des deux est en cause permettrait d'énumérer les comptes.
   */
  async signIn(
    email: string,
    password: string,
    context: SessionContext = {},
  ): Promise<{ user: AuthUser; session: Session }> {
    const { rows } = await this.pool.query<
      AuthUser & { password_hash: string | null; password_salt: string | null }
    >(
      `SELECT id, email, name, role, password_hash, password_salt
         FROM users
        WHERE lower(email) = lower($1)`,
      [normaliserEmail(email)],
    );

    const row = rows[0];

    if (!row?.password_hash || !row.password_salt) {
      // Compte inexistant, ou sans mot de passe (connexion externe) : on
      // hache quand même pour que la réponse prenne le même temps qu'un
      // échec de mot de passe. Sans cela, la durée trahit l'existence du
      // compte.
      await verifyPassword(password, LEURRE);
      throw new AuthError("INVALID_CREDENTIALS", "Identifiants invalides.");
    }

    const correct = await verifyPassword(password, {
      hash: row.password_hash,
      salt: row.password_salt,
    });
    if (!correct) {
      throw new AuthError("INVALID_CREDENTIALS", "Identifiants invalides.");
    }

    const user: AuthUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
    };
    return { user, session: await this.createSession(user.id, context) };
  }

  async createSession(
    userId: string,
    context: SessionContext = {},
  ): Promise<Session> {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(
      Date.now() +
        (context.lifetimeDays ?? DEFAULT_SESSION_DAYS) * 24 * 60 * 60 * 1000,
    );

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        hashToken(token),
        expiresAt,
        context.userAgent ?? null,
        context.ip ?? null,
      ],
    );

    return { id: rows[0]!.id, userId, token, expiresAt };
  }

  /**
   * Résout un jeton en utilisateur. Renvoie null plutôt que de lever :
   * une session absente est un cas courant, pas une anomalie.
   */
  async resolveSession(token: string): Promise<AuthUser | null> {
    if (!token) return null;

    const { rows } = await this.pool.query<
      AuthUser & { session_id: string }
    >(
      `SELECT u.id, u.email, u.name, u.role, s.id AS session_id
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()`,
      [hashToken(token)],
    );

    const row = rows[0];
    if (!row) return null;

    // Trace de dernier usage, utile pour l'écran des sessions actives.
    // Volontairement non bloquant : une panne d'écriture ne doit pas
    // empêcher de se connecter.
    void this.pool
      .query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [
        row.session_id,
      ])
      .catch(() => {});

    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }

  async revokeSession(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(token)],
    );
  }

  /** Révoque toutes les sessions d'un compte — après un changement de mot de passe. */
  async revokeAllSessions(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  }

  async changePassword(userId: string, nouveau: string): Promise<void> {
    assertPasswordAcceptable(nouveau);
    const { hash, salt } = await hashPassword(nouveau);
    await this.pool.query(
      `UPDATE users SET password_hash = $2, password_salt = $3, updated_at = now()
        WHERE id = $1`,
      [userId, hash, salt],
    );
    // Un changement de mot de passe doit expulser les sessions existantes :
    // c'est tout l'intérêt de l'opération si le compte était compromis.
    await this.revokeAllSessions(userId);
  }

  /** Supprime les sessions expirées ou révoquées depuis longtemps. */
  async pruneSessions(olderThanDays = 30): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM sessions
        WHERE (expires_at < now() - ($1 || ' days')::interval)
           OR (revoked_at IS NOT NULL
               AND revoked_at < now() - ($1 || ' days')::interval)`,
      [olderThanDays],
    );
    return rowCount ?? 0;
  }
}

/**
 * Empreinte factice, de forme valide, pour que l'échec sur compte inexistant
 * coûte le même temps qu'un mot de passe erroné.
 */
const LEURRE: HashedPassword = {
  hash: Buffer.alloc(64, 0).toString("base64"),
  salt: Buffer.alloc(32, 0).toString("base64"),
};

function normaliserEmail(email: string): string {
  return email.trim();
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

