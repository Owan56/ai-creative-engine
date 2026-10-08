/**
 * API REST (cahier des charges §60, §79).
 *
 * Le frontend ne parle jamais au GPU ni à la file : il parle à cette API,
 * qui empile un job. Toute route touchant à des données utilisateur passe
 * par `requireUser`, qui résout la session et fournit l'appelant — il n'y a
 * pas de chemin où l'on manipule un identifiant sans savoir qui le demande.
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import type { Pool } from "pg";
import {
  AssetAccess,
  AuthError,
  AuthService,
  NotFoundError,
  WeakPasswordError,
  buildStorageKey,
  type AuthUser,
} from "@ace/auth";
import { CreditError, CreditService } from "@ace/billing";
import { GenerationError, type ModelRouter } from "@ace/ai-core";
import type { GenerationPipeline } from "@ace/queue";

export interface ServerDeps {
  readonly pool: Pool;
  readonly auth: AuthService;
  readonly assets: AssetAccess;
  readonly credits: CreditService;
  readonly router: ModelRouter;
  readonly pipeline: GenerationPipeline;
  /** Met la génération en file. Séparé pour tester sans Redis. */
  readonly enqueue: (generationId: string, userId: string) => Promise<void>;
  readonly corsOrigin?: string;
}

/**
 * Limitation de débit, en mémoire.
 *
 * Suffisant pour une seule instance. Avec plusieurs répliques il faudra la
 * déplacer dans Redis, sinon chaque instance autorise son propre quota.
 */
class RateLimiter {
  private readonly compteurs = new Map<string, { n: number; reset: number }>();

  constructor(
    private readonly max: number,
    private readonly fenetreMs: number,
  ) {}

  depasse(cle: string): boolean {
    const maintenant = Date.now();
    const actuel = this.compteurs.get(cle);

    if (!actuel || maintenant > actuel.reset) {
      this.compteurs.set(cle, { n: 1, reset: maintenant + this.fenetreMs });
      return false;
    }
    actuel.n += 1;
    return actuel.n > this.max;
  }
}

// La connexion est la cible privilégiée d'une attaque par force brute.
const limiteConnexion = new RateLimiter(10, 60_000);
const limiteGeneration = new RateLimiter(30, 60_000);

function ip(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    request.ip
  );
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  void app.register(cors, {
    origin: deps.corsOrigin ?? true,
    credentials: true,
  });

  /** Résout la session. Toute route protégée commence par là. */
  async function requireUser(request: FastifyRequest): Promise<AuthUser> {
    const entete = request.headers.authorization;
    const token = entete?.startsWith("Bearer ") ? entete.slice(7) : undefined;
    const user = token ? await deps.auth.resolveSession(token) : null;
    if (!user) throw new HttpError(401, "Authentification requise.");
    return user;
  }

  // ---------------------------------------------------------------- santé

  app.get("/health", async () => ({ status: "ok" }));

  // ---------------------------------------------------------------- compte

  app.post("/v1/auth/signup", async (request, reply) => {
    const { email, password, name } = (request.body ?? {}) as Record<string, string>;
    if (!email || !password) throw new HttpError(400, "email et password requis.");

    const user = await deps.auth.signUp({ email, password, ...(name ? { name } : {}) });
    // 50 crédits de bienvenue (§32), pour que l'inscription mène à un essai
    // immédiat plutôt qu'à un mur de paiement.
    await deps.credits.grant(user.id, 50, {
      kind: "GRANT",
      idempotencyKey: `welcome:${user.id}`,
    });
    const session = await deps.auth.createSession(user.id);

    return reply.code(201).send({ user, token: session.token });
  });

  app.post("/v1/auth/login", async (request) => {
    if (limiteConnexion.depasse(ip(request))) {
      throw new HttpError(429, "Trop de tentatives. Réessaie dans une minute.");
    }
    const { email, password } = (request.body ?? {}) as Record<string, string>;
    if (!email || !password) throw new HttpError(400, "email et password requis.");

    const { user, session } = await deps.auth.signIn(email, password, {
      ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
      ip: ip(request),
    });
    return { user, token: session.token };
  });

  app.post("/v1/auth/logout", async (request) => {
    const entete = request.headers.authorization;
    if (entete?.startsWith("Bearer ")) await deps.auth.revokeSession(entete.slice(7));
    return { ok: true };
  });

  app.get("/v1/me", async (request) => {
    const user = await requireUser(request);
    return { user, credits: await deps.credits.getBalance(user.id) };
  });

  // ---------------------------------------------------------------- actifs

  app.post("/v1/assets", async (request, reply) => {
    const user = await requireUser(request);
    const { contentType, sizeBytes, kind } = (request.body ?? {}) as Record<string, unknown>;

    if (typeof contentType !== "string" || typeof sizeBytes !== "number") {
      throw new HttpError(400, "contentType et sizeBytes requis.");
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new HttpError(415, "Format d'image non supporté.");
    }
    if (sizeBytes <= 0 || sizeBytes > 20 * 1024 * 1024) {
      throw new HttpError(413, "Image trop volumineuse (20 Mo maximum).");
    }

    const extension = contentType.split("/")[1] ?? "bin";
    const asset = await deps.assets.create(user, {
      kind: (kind as "PRODUCT_IMAGE") ?? "PRODUCT_IMAGE",
      storageKey: buildStorageKey(user.id, "PRODUCT_IMAGE", extension),
      contentType,
      sizeBytes,
    });

    return reply.code(201).send({ asset });
  });

  app.get("/v1/assets", async (request) => {
    const user = await requireUser(request);
    return { assets: await deps.assets.listForUser(user) };
  });

  // ---------------------------------------------------------------- générations

  app.post("/v1/generations", async (request, reply) => {
    const user = await requireUser(request);
    if (limiteGeneration.depasse(user.id)) {
      throw new HttpError(429, "Trop de générations demandées. Patiente un instant.");
    }

    const corps = (request.body ?? {}) as Record<string, unknown>;
    const prompt = corps.prompt;
    if (typeof prompt !== "string" || prompt.trim().length < 3) {
      throw new HttpError(400, "Un prompt d'au moins 3 caractères est requis.");
    }

    const demande = {
      generationId: "estimation",
      prompt,
      durationSeconds: Number(corps.durationSeconds ?? 5),
      resolution: String(corps.resolution ?? "1080p"),
      aspectRatio: String(corps.aspectRatio ?? "9:16"),
      mode: String(corps.mode ?? "product"),
    } as Parameters<ModelRouter["route"]>[0];

    // Le coût vient du routeur, jamais du client : sinon n'importe qui
    // pourrait annoncer son propre prix et générer gratuitement.
    const solde = await deps.credits.getBalance(user.id);
    const decision = await deps.router.route(demande, { maxCredits: solde.available });

    // Plancher à 1 crédit. Un moteur qui rapporte un coût nul — le mock, ou
    // un tarif mal configuré — rendrait les générations gratuites et
    // contournerait tout le système de crédits.
    const credits = Math.max(1, decision.chosen.cost.credits);
    if (credits > solde.available) {
      throw new HttpError(402, "Crédits insuffisants pour cette génération.");
    }

    const accepted = await deps.pipeline.accept({
      userId: user.id,
      prompt,
      durationSeconds: demande.durationSeconds,
      resolution: demande.resolution,
      aspectRatio: demande.aspectRatio,
      mode: demande.mode,
      estimatedCredits: credits,
      ...(typeof corps.inputAssetId === "string" ? { inputAssetId: corps.inputAssetId } : {}),
    });

    await deps.enqueue(accepted.id, user.id);
    return reply.code(202).send({ generation: accepted });
  });

  app.get("/v1/generations", async (request) => {
    const user = await requireUser(request);
    const { rows } = await deps.pool.query(
      `SELECT id, status, prompt, duration_seconds, resolution, aspect_ratio,
              provider_id, estimated_credits, actual_credits, output_asset_id,
              error_code, created_at, completed_at
         FROM generations
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [user.id],
    );
    return { generations: rows };
  });

  app.get("/v1/generations/:id", async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };

    const { rows } = await deps.pool.query(
      `SELECT id, status, prompt, provider_id, estimated_credits, actual_credits,
              output_asset_id, error_code, created_at, completed_at
         FROM generations
        WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    );
    // 404 et non 403 : un 403 confirmerait l'existence de l'identifiant.
    if (!rows[0]) throw new HttpError(404, "Génération introuvable.");
    return { generation: rows[0] };
  });

  app.post("/v1/generations/:id/cancel", async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const annulee = await deps.pipeline.cancel(id, user.id);
    if (!annulee) throw new HttpError(409, "Cette génération ne peut plus être annulée.");
    return { ok: true };
  });

  // ---------------------------------------------------------------- erreurs

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message });
    }
    if (err instanceof AuthError) {
      const status = err.code === "EMAIL_TAKEN" ? 409 : 401;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    if (err instanceof WeakPasswordError) {
      return reply.code(400).send({ error: err.message });
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    if (err instanceof CreditError) {
      const status = err.code === "INSUFFICIENT_CREDITS" ? 402 : 400;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    if (err instanceof GenerationError) {
      const status = err.code === "PROVIDER_UNAVAILABLE" ? 503 : 400;
      return reply.code(status).send({ error: err.message, code: err.code });
    }

    // Jamais de détail interne vers le client : il part dans les journaux.
    console.error("[api]", err);
    return reply.code(500).send({ error: "Erreur serveur." });
  });

  return app;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
