/**
 * Tests de l'orchestration, contre un vrai PostgreSQL.
 *
 * La propriété centrale : les crédits réservés sont toujours réglés. Un
 * chemin de sortie qui les laisserait gelés immobiliserait le solde de
 * l'utilisateur sans que rien ne le signale.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  GenerationError,
  MockVideoProvider,
  ModelRegistry,
  ModelRouter,
  type ModelLicense,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "@ace/ai-core";
import { CreditService } from "@ace/billing";
import { GenerationPipeline } from "../src/GenerationPipeline.js";

const DATABASE_URL = process.env.DATABASE_URL;
const decrire = DATABASE_URL ? describe : describe.skip;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const credits = new CreditService(pool);

const LICENCE: ModelLicense = {
  name: "Apache-2.0",
  sourceUrl: "https://example.invalid",
  commercialAllowed: true,
  territorialRestrictions: [],
  attributionRequired: false,
  verifiedAt: "2026-10-08",
};

afterAll(async () => {
  await pool.end().catch(() => {});
});

/** Enregistre la vidéo produite comme un actif, comme le ferait le worker. */
async function persistOutput(
  userId: string,
  generationId: string,
  result: VideoGenerationResult,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assets (user_id, kind, storage_key, content_type, size_bytes)
     VALUES ($1, 'VIDEO', $2, 'video/mp4', 0) RETURNING id`,
    [userId, `${userId}/video/${generationId}.mp4`],
  );
  return rows[0]!.id;
}

function pipelineAvec(
  provider = new MockVideoProvider(),
  options: { maxConcurrentPerUser?: number } = {},
) {
  const registre = new ModelRegistry();
  registre.register(provider, LICENCE, { enabled: true });
  return new GenerationPipeline({
    pool,
    credits,
    router: new ModelRouter(registre),
    persistOutput,
    ...options,
  });
}

async function utilisateur(creditsInitiaux = 100): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`p-${crypto.randomUUID()}@example.invalid`],
  );
  const id = rows[0]!.id;
  await credits.createAccount(id);
  if (creditsInitiaux > 0) await credits.grant(id, creditsInitiaux);
  return id;
}

function demande(userId: string, surcharges = {}) {
  return {
    userId,
    prompt: "un collier sur fond studio",
    durationSeconds: 10,
    resolution: "1080p",
    aspectRatio: "9:16",
    mode: "product",
    estimatedCredits: 15,
    ...surcharges,
  };
}

async function statut(id: string) {
  const { rows } = await pool.query(
    `SELECT status, actual_credits, output_asset_id, error_code
       FROM generations WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

decrire("GenerationPipeline", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
  });

  it("gèle les crédits à l'acceptation sans encore les débiter", async () => {
    const userId = await utilisateur(100);
    await pipelineAvec().accept(demande(userId));

    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 15,
      available: 85,
    });
  });

  it("débite les crédits et produit un actif quand tout se passe bien", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(userId));
    const issue = await pipeline.run(id);

    expect(issue.status).toBe("COMPLETED");
    expect(issue.outputAssetId).toBeTruthy();
    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 85,
      reserved: 0,
    });
  });

  it("rend les crédits quand le moteur échoue (§106)", async () => {
    const userId = await utilisateur(100);
    // Le GPU tombe en cours de génération.
    const pipeline = pipelineAvec(
      new MockVideoProvider({ failureRate: 1, random: () => 0 }),
    );

    const { id } = await pipeline.accept(demande(userId));
    const issue = await pipeline.run(id);

    expect(issue.status).toBe("FAILED");
    // Le solde est revenu à son état d'avant : rien n'est gelé, rien n'est payé.
    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 0,
      available: 100,
    });
  });

  it("rend les crédits quand aucun moteur ne convient", async () => {
    const userId = await utilisateur(100);
    const registreVide = new ModelRegistry();
    const pipeline = new GenerationPipeline({
      pool,
      credits,
      router: new ModelRouter(registreVide),
      persistOutput,
    });

    const { id } = await pipeline.accept(demande(userId));
    const issue = await pipeline.run(id);

    expect(issue.status).toBe("FAILED");
    expect(issue.errorCode).toBe("PROVIDER_UNAVAILABLE");
    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 0,
    });
  });

  it("rend les crédits si l'enregistrement du résultat échoue", async () => {
    const userId = await utilisateur(100);
    const registre = new ModelRegistry();
    registre.register(new MockVideoProvider(), LICENCE, { enabled: true });

    // Le stockage objet est indisponible après une génération réussie :
    // l'utilisateur n'a rien reçu, il ne doit rien payer.
    const pipeline = new GenerationPipeline({
      pool,
      credits,
      router: new ModelRouter(registre),
      persistOutput: async () => {
        throw new Error("stockage indisponible");
      },
    });

    const { id } = await pipeline.accept(demande(userId));
    expect((await pipeline.run(id)).status).toBe("FAILED");
    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 0,
    });
  });

  it("refuse la demande et ne laisse rien en file si le solde est insuffisant", async () => {
    const userId = await utilisateur(10);
    const pipeline = pipelineAvec();

    await expect(pipeline.accept(demande(userId))).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });

    const { rows } = await pool.query(
      `SELECT status FROM generations WHERE user_id = $1`,
      [userId],
    );
    // La ligne existe pour la traçabilité, mais marquée FAILED : laissée en
    // QUEUED, un worker la reprendrait et tournerait gratuitement.
    expect(rows[0]).toMatchObject({ status: "FAILED" });
    expect(await credits.getBalance(userId)).toMatchObject({ reserved: 0 });
  });

  it("ne relance pas une génération déjà réglée", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(userId));
    await pipeline.run(id);

    // Un job rejoué ne doit pas repayer du GPU.
    const rejoue = await pipeline.run(id);
    expect(rejoue.status).toBe("COMPLETED");
    expect(await credits.getBalance(userId)).toMatchObject({ balance: 85 });
  });

  it("rend les crédits à l'annulation", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(userId));
    expect(await pipeline.cancel(id, userId)).toBe(true);

    expect(await credits.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 0,
    });
    expect((await statut(id)).status).toBe("CANCELLED");
  });

  it("n'annule pas la génération d'un autre utilisateur", async () => {
    const alice = await utilisateur(100);
    const bob = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(alice));
    expect(await pipeline.cancel(id, bob)).toBe(false);
    expect((await statut(id)).status).toBe("QUEUED");
  });

  it("n'annule plus une génération terminée", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(userId));
    await pipeline.run(id);

    expect(await pipeline.cancel(id, userId)).toBe(false);
    expect(await credits.getBalance(userId)).toMatchObject({ balance: 85 });
  });

  it("applique la limite de générations simultanées (§83)", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec(new MockVideoProvider(), {
      maxConcurrentPerUser: 2,
    });

    await pipeline.accept(demande(userId, { estimatedCredits: 5 }));
    await pipeline.accept(demande(userId, { estimatedCredits: 5 }));

    await expect(
      pipeline.accept(demande(userId, { estimatedCredits: 5 })),
    ).rejects.toBeInstanceOf(GenerationError);

    // Seules les deux premières ont gelé des crédits.
    expect(await credits.getBalance(userId)).toMatchObject({ reserved: 10 });
  });

  it("conserve la seed pour la reproductibilité (§103)", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(userId, { seed: 123456 }));
    await pipeline.run(id);

    const { rows } = await pool.query<{ seed: string }>(
      `SELECT seed FROM generations WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]!.seed)).toBe(123456);
  });

  it("ne débite jamais plus que l'estimation annoncée", async () => {
    const userId = await utilisateur(100);
    const registre = new ModelRegistry();

    // Le moteur rapporte un coût bien supérieur à l'estimation acceptée.
    const gourmand = new MockVideoProvider();
    gourmand.estimateCost = async (r: VideoGenerationRequest) => ({
      gpuSeconds: r.durationSeconds,
      usd: 99,
      credits: 99,
    });
    registre.register(gourmand, LICENCE, { enabled: true });

    const pipeline = new GenerationPipeline({
      pool,
      credits,
      router: new ModelRouter(registre),
      persistOutput,
    });

    const { id } = await pipeline.accept(demande(userId));
    const issue = await pipeline.run(id);

    // Le routeur l'écarte car il dépasse le budget : l'utilisateur ne peut
    // pas être facturé au-delà de ce qu'il a accepté.
    expect(issue.status).toBe("FAILED");
    expect(await credits.getBalance(userId)).toMatchObject({ balance: 100 });
  });

  it("enregistre le moteur retenu, pour l'audit (§101)", async () => {
    const userId = await utilisateur(100);
    const pipeline = pipelineAvec();

    const { id } = await pipeline.accept(demande(userId));
    await pipeline.run(id);

    const { rows } = await pool.query<{ provider_id: string }>(
      `SELECT provider_id FROM generations WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.provider_id).toBe("mock");
  });
});
