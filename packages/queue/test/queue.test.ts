/**
 * Test de bout en bout de la file, contre un vrai Redis.
 *
 * On ne teste pas BullMQ (c'est son travail), mais notre câblage : un job mis
 * en file atteint-il le pipeline, et le dédoublonnage tient-il ?
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import {
  MockVideoProvider,
  ModelRegistry,
  ModelRouter,
  type ModelLicense,
  type VideoGenerationResult,
} from "@ace/ai-core";
import { CreditService } from "@ace/billing";
import { GenerationPipeline } from "../src/GenerationPipeline.js";
import {
  createGenerationQueue,
  createGenerationWorker,
  enqueueGeneration,
} from "../src/generationQueue.js";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const decrire = DATABASE_URL && REDIS_URL ? describe : describe.skip;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const credits = new CreditService(pool);

/**
 * BullMQ attend des options de connexion IORedis, et exige
 * `maxRetriesPerRequest: null` pour les workers — sans quoi ioredis abandonne
 * les commandes bloquantes sur lesquelles repose la file.
 */
const url = REDIS_URL ? new URL(REDIS_URL) : null;
const connection = {
  host: url?.hostname ?? "localhost",
  port: Number(url?.port || 6379),
  maxRetriesPerRequest: null,
};

const LICENCE: ModelLicense = {
  name: "Apache-2.0",
  sourceUrl: "https://example.invalid",
  commercialAllowed: true,
  territorialRestrictions: [],
  attributionRequired: false,
  verifiedAt: "2026-10-08",
};

const aFermer: Array<{ close: () => Promise<void> }> = [];

afterAll(async () => {
  await Promise.allSettled(aFermer.map((r) => r.close()));
  await pool.end().catch(() => {});
});

async function persistOutput(
  userId: string,
  generationId: string,
  _result: VideoGenerationResult,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assets (user_id, kind, storage_key, content_type, size_bytes)
     VALUES ($1, 'VIDEO', $2, 'video/mp4', 0) RETURNING id`,
    [userId, `${userId}/video/${generationId}.mp4`],
  );
  return rows[0]!.id;
}

function nouveauPipeline() {
  const registre = new ModelRegistry();
  registre.register(new MockVideoProvider(), LICENCE, { enabled: true });
  return new GenerationPipeline({
    pool,
    credits,
    router: new ModelRouter(registre),
    persistOutput,
  });
}

async function utilisateur(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`q-${crypto.randomUUID()}@example.invalid`],
  );
  const id = rows[0]!.id;
  await credits.createAccount(id);
  await credits.grant(id, 100);
  return id;
}

decrire("file de génération", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
    const q = createGenerationQueue(connection);
    await q.obliterate({ force: true }).catch(() => {});
    await q.close();
  });

  it("achemine un job jusqu'au pipeline et débite les crédits", async () => {
    const userId = await utilisateur();
    const pipeline = nouveauPipeline();
    const queue = createGenerationQueue(connection);
    aFermer.push(queue);

    const { id } = await pipeline.accept({
      userId,
      prompt: "un produit",
      durationSeconds: 10,
      resolution: "1080p",
      aspectRatio: "9:16",
      mode: "product",
      estimatedCredits: 15,
    });

    let resolve!: (statut: string) => void;
    const termine = new Promise<string>((r) => {
      resolve = r;
    });
    const worker = createGenerationWorker({
      connection,
      pipeline,
      onOutcome: (o) => resolve(o.status),
    });

    await enqueueGeneration(queue, { generationId: id, userId });

    try {
      expect(await termine).toBe("COMPLETED");
    } finally {
      // Un worker laissé en vie consommerait les jobs du test suivant.
      await worker.close();
    }
    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 85,
      reserved: 0,
    });
  }, 30_000);

  it("refuse un doublon pour la même génération", async () => {
    const queue = createGenerationQueue(connection);
    aFermer.push(queue);

    const generationId = crypto.randomUUID();
    const data = { generationId, userId: crypto.randomUUID() };

    // Un double clic ou un rejeu d'API ne doit pas lancer deux fois le même
    // travail GPU : l'identifiant de job vaut l'identifiant de génération.
    await enqueueGeneration(queue, data);
    await enqueueGeneration(queue, data);

    expect(await queue.getWaitingCount()).toBe(1);
  }, 20_000);
});
