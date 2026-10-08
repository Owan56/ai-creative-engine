/**
 * Hachage de mots de passe (scrypt).
 *
 * scrypt est dans la bibliothèque standard de Node : pas de dépendance
 * externe sur un composant de sécurité, et pas de binaire natif à compiler.
 *
 * Le sel est tiré par utilisateur, donc deux comptes partageant le même mot
 * de passe n'ont pas la même empreinte, et une table précalculée ne sert à
 * rien.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Paramètres de coût. N=2^15 vise ~100 ms par hachage sur un serveur
 * courant : assez lent pour décourager une attaque hors ligne, assez rapide
 * pour une connexion interactive.
 */
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

/** Longueur minimale. Au-delà, on ne rejette pas : la longueur prime. */
export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

export interface HashedPassword {
  readonly hash: string;
  readonly salt: string;
}

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }
  // Une limite haute évite qu'un mot de passe d'un mégaoctet ne devienne un
  // vecteur de déni de service sur le hachage.
  if (password.length > 1024) {
    throw new WeakPasswordError("Mot de passe trop long (1024 caractères maximum).");
  }
}

export async function hashPassword(password: string): Promise<HashedPassword> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);
  return { hash: hash.toString("base64"), salt: salt.toString("base64") };
}

/**
 * Compare en temps constant. Une comparaison naïve laisserait fuiter, par la
 * durée, le nombre d'octets corrects au début du hachage.
 */
export async function verifyPassword(
  password: string,
  stored: HashedPassword,
): Promise<boolean> {
  if (password.length === 0 || password.length > 1024) return false;

  let attendu: Buffer;
  let sel: Buffer;
  try {
    attendu = Buffer.from(stored.hash, "base64");
    sel = Buffer.from(stored.salt, "base64");
  } catch {
    return false;
  }
  if (attendu.length !== KEY_LENGTH) return false;

  const candidat = await scryptAsync(password, sel, KEY_LENGTH, PARAMS);
  return timingSafeEqual(candidat, attendu);
}
