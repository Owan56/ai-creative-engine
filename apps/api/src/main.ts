/**
 * Point d'entrée de l'API.
 *
 * Assemble les dépendances depuis la configuration, puis sert. Rien de
 * métier ici : tout est dans les paquets, pour rester testable.
 */

import pg from "pg";
import { AssetAccess, AuthService } from "@ace/auth";
import { CreditService } from "@ace/billing";
import { ModelRouter, buildRegistry, configFromEnv } from "@ace/ai-core";
import {
  GenerationPipeline,
  createGenerationQueue,
  enqueueGeneration,
} from "@ace/queue";
import { buildServer } from "./server.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL manquante.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const credits = new CreditService(pool);
const registry = buildRegistry(configFromEnv());
const router = new ModelRouter(registry);

const moteurs = registry.usable().map((e) => e.provider.id);
console.log(`Moteurs disponibles : ${moteurs.join(", ") || "aucun"}`);

const redis = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  maxRetriesPerRequest: null,
};
const queue = createGenerationQueue(connection);

const pipeline = new GenerationPipeline({
  pool,
  credits,
  router,
  // Enregistre la vidéo produite comme un actif de l'utilisateur.
  persistOutput: async (userId, generationId, result) => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO assets (user_id, kind, storage_key, content_type, size_bytes)
       VALUES ($1, 'VIDEO', $2, 'video/mp4', 0) RETURNING id`,
      [userId, result.videoKey],
    );
    return rows[0]!.id;
  },
  maxConcurrentPerUser: Number(process.env.MAX_CONCURRENT_GENERATIONS ?? 2),
});

const app = buildServer({
  pool,
  auth: new AuthService(pool),
  assets: new AssetAccess(pool),
  credits,
  router,
  pipeline,
  enqueue: (generationId, userId) =>
    enqueueGeneration(queue, { generationId, userId }),
  ...(process.env.CORS_ORIGIN ? { corsOrigin: process.env.CORS_ORIGIN } : {}),
});

/**
 * En production, l'API sert aussi le build de l'interface.
 *
 * Une seule origine : pas de CORS à ouvrir, pas de proxy à configurer, et le
 * chemin relatif /v1 que l'interface appelle tombe juste. Absent, le serveur
 * reste une API pure — c'est le cas en développement, où Vite sert l'interface.
 */
const webDir = process.env.WEB_DIST;
if (webDir) {
  const fastifyStatic = (await import("@fastify/static")).default;
  await app.register(fastifyStatic, { root: webDir });

  // Toute route inconnue rend l'application : la navigation côté client doit
  // survivre à un rechargement sur une URL profonde.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/v1")) {
      return reply.code(404).send({ error: "Route inconnue." });
    }
    return reply.sendFile("index.html");
  });
  console.log(`Interface servie depuis ${webDir}`);
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API sur http://localhost:${port}`);

// Arrêt propre : sans cela, une requête en cours est coupée net au déploiement.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await queue.close();
      await pool.end();
      process.exit(0);
    })();
  });
}
