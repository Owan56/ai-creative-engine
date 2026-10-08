/**
 * Client de l'API Aurya.
 *
 * Toutes les requêtes passent par ici : un seul endroit sait comment le jeton
 * est transporté, comment une erreur est présentée, et quoi faire quand la
 * session expire.
 *
 * L'URL est relative (`/v1/...`) : aucune adresse n'est codée en dur, donc le
 * même build fonctionne en local derrière le proxy Vite et en production.
 */

const CLE_JETON = "aurya.token";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: "USER" | "ADMIN";
}

export interface CreditBalance {
  readonly balance: number;
  readonly reserved: number;
  readonly available: number;
}

export type GenerationStatus =
  | "QUEUED"
  | "PROCESSING"
  | "GENERATING"
  | "POST_PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface GenerationRow {
  readonly id: string;
  readonly status: GenerationStatus;
  readonly prompt: string;
  readonly duration_seconds: number;
  readonly resolution: string;
  readonly aspect_ratio: string;
  readonly provider_id: string | null;
  readonly estimated_credits: number;
  readonly actual_credits: number | null;
  readonly output_asset_id: string | null;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

/**
 * Erreur présentable à l'utilisateur.
 *
 * L'API ne renvoie jamais de détail interne ; ce qui arrive ici est donc
 * affichable tel quel.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------- jeton

/**
 * Le jeton vit dans `localStorage`. Les lectures sont protégées : en
 * navigation privée ou avec les données de site bloquées, l'accès peut lever,
 * et l'application doit alors fonctionner comme un visiteur déconnecté.
 */
export function readToken(): string | null {
  try {
    return localStorage.getItem(CLE_JETON);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(CLE_JETON);
    else localStorage.setItem(CLE_JETON, token);
  } catch {
    // Pas de stockage : la session ne survivra pas au rechargement, mais
    // l'application reste utilisable.
  }
}

// ---------------------------------------------------------------- transport

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/** Appelée quand l'API répond 401 : la session n'est plus valable. */
let onSessionPerdue: (() => void) | null = null;

export function setSessionExpiredHandler(fn: () => void): void {
  onSessionPerdue = fn;
}

async function request<T>(chemin: string, options: RequestOptions = {}): Promise<T> {
  const token = readToken();

  let reponse: Response;
  try {
    reponse = await fetch(`/v1${chemin}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "Impossible de joindre le serveur. Vérifie ta connexion.");
  }

  if (reponse.status === 204) return undefined as T;

  let corps: unknown;
  try {
    corps = await reponse.json();
  } catch {
    corps = null;
  }

  if (!reponse.ok) {
    // Un 401 signifie que le jeton ne vaut plus rien : on le jette, sinon
    // chaque requête suivante échouerait de la même façon.
    if (reponse.status === 401) {
      writeToken(null);
      onSessionPerdue?.();
    }
    const d = corps as { error?: string; code?: string } | null;
    throw new ApiError(
      reponse.status,
      d?.error ?? "Une erreur est survenue.",
      d?.code,
    );
  }

  return corps as T;
}

// ---------------------------------------------------------------- compte

export async function signUp(
  email: string,
  password: string,
  name?: string,
): Promise<User> {
  const r = await request<{ user: User; token: string }>("/auth/signup", {
    method: "POST",
    body: { email, password, ...(name ? { name } : {}) },
  });
  writeToken(r.token);
  return r.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const r = await request<{ user: User; token: string }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  writeToken(r.token);
  return r.user;
}

export async function signOut(): Promise<void> {
  // Le jeton part d'abord : même si l'appel échoue, la session locale est
  // close côté navigateur.
  try {
    await request<void>("/auth/logout", { method: "POST" });
  } finally {
    writeToken(null);
  }
}

export function me(signal?: AbortSignal): Promise<{ user: User; credits: CreditBalance }> {
  return request("/me", { ...(signal ? { signal } : {}) });
}

// ---------------------------------------------------------------- générations

export function listGenerations(
  signal?: AbortSignal,
): Promise<{ generations: GenerationRow[] }> {
  return request("/generations", { ...(signal ? { signal } : {}) });
}

export interface CreateGenerationInput {
  prompt: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  mode?: string;
}

export function createGeneration(
  input: CreateGenerationInput,
): Promise<{ generation: { id: string; status: string; estimatedCredits: number } }> {
  return request("/generations", { method: "POST", body: input });
}

export function cancelGeneration(id: string): Promise<{ ok: true }> {
  return request(`/generations/${id}/cancel`, { method: "POST" });
}
