/**
 * Tests de l'API, contre un vrai PostgreSQL et un serveur Fastify réel.
 * La file est remplacée par un espion : on vérifie le câblage, pas BullMQ.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  MockVideoProvider,
  ModelRegistry,
  ModelRouter,
  type ModelLicense,
} from "@ace/ai-core";
import { AssetAccess, AuthService } from "@ace/auth";
import { CreditService } from "@ace/billing";
import { GenerationPipeline } from "@ace/queue";
import { buildServer } from "../src/server.js";

const DATABASE_URL = process.env.DATABASE_URL;
const decrire = DATABASE_URL ? describe : describe.skip;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const credits = new CreditService(pool);

const LICENCE: ModelLicense = {
  name: "Interne",
  sourceUrl: "https://example.invalid",
  commercialAllowed: true,
  territorialRestrictions: [],
  attributionRequired: false,
  verifiedAt: "2026-10-08",
};

const registre = new ModelRegistry();
registre.register(new MockVideoProvider(), LICENCE, { enabled: true });
const router = new ModelRouter(registre);

const misEnFile: string[] = [];

const app = buildServer({
  pool,
  auth: new AuthService(pool),
  assets: new AssetAccess(pool),
  credits,
  router,
  pipeline: new GenerationPipeline({
    pool,
    credits,
    router,
    persistOutput: async (userId, generationId) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO assets (user_id, kind, storage_key, content_type, size_bytes)
         VALUES ($1, 'VIDEO', $2, 'video/mp4', 0) RETURNING id`,
        [userId, `${userId}/v/${generationId}.mp4`],
      );
      return rows[0]!.id;
    },
  }),
  enqueue: async (id) => {
    misEnFile.push(id);
  },
});

afterAll(async () => {
  await app.close();
  await pool.end().catch(() => {});
});

const MDP = "un-mot-de-passe-long";

async function inscrire() {
  const r = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email: `u-${crypto.randomUUID()}@example.invalid`, password: MDP },
  });
  return r.json() as { user: { id: string; email: string }; token: string };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

decrire("API", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
    misEnFile.length = 0;
  });

  it("répond sur /health sans authentification", async () => {
    const r = await app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
  });

  it("inscrit un utilisateur avec ses crédits de bienvenue", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: `n-${crypto.randomUUID()}@example.invalid`, password: MDP },
    });

    expect(r.statusCode).toBe(201);
    const { user, token } = r.json();
    expect(token).toBeTruthy();

    // L'inscription doit mener à un essai immédiat, pas à un mur de paiement.
    expect((await credits.getBalance(user.id)).balance).toBe(50);
  });

  it("refuse un mot de passe trop court", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "x@example.invalid", password: "court" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("refuse une adresse déjà prise", async () => {
    const { user } = await inscrire();
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: user.email, password: MDP },
    });
    expect(r.statusCode).toBe(409);
  });

  it("connecte avec le bon mot de passe et refuse le mauvais", async () => {
    const { user } = await inscrire();

    const bon = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: MDP },
    });
    expect(bon.statusCode).toBe(200);

    const mauvais = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: user.email, password: "faux-mot-de-passe" },
    });
    expect(mauvais.statusCode).toBe(401);
  });

  it("protège les routes privées", async () => {
    for (const url of ["/v1/me", "/v1/assets", "/v1/generations"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(401);
    }
  });

  it("rejette un jeton inventé", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth("jeton-invente"),
    });
    expect(r.statusCode).toBe(401);
  });

  it("invalide le jeton après déconnexion", async () => {
    const { token } = await inscrire();
    await app.inject({ method: "POST", url: "/v1/auth/logout", headers: auth(token) });

    const r = await app.inject({ method: "GET", url: "/v1/me", headers: auth(token) });
    expect(r.statusCode).toBe(401);
  });

  it("accepte une génération, la met en file et gèle les crédits", async () => {
    const { user, token } = await inscrire();

    const r = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: auth(token),
      payload: { prompt: "un collier doré sur fond studio", durationSeconds: 5 },
    });

    expect(r.statusCode).toBe(202);
    expect(misEnFile).toHaveLength(1);
    expect((await credits.getBalance(user.id)).reserved).toBeGreaterThan(0);
  });

  it("refuse un prompt vide", async () => {
    const { token } = await inscrire();
    const r = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: auth(token),
      payload: { prompt: "ab" },
    });
    expect(r.statusCode).toBe(400);
    expect(misEnFile).toHaveLength(0);
  });

  it("répond 402 quand les crédits manquent", async () => {
    const { user, token } = await inscrire();
    // On vide le compte : la génération doit être refusée, pas mise en file.
    await pool.query(`UPDATE credit_accounts SET balance = 0 WHERE user_id = $1`, [
      user.id,
    ]);

    const r = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: auth(token),
      payload: { prompt: "un collier doré" },
    });

    expect([402, 503]).toContain(r.statusCode);
    expect(misEnFile).toHaveLength(0);
  });

  it("ne laisse pas voir la génération d'autrui (§108)", async () => {
    const alice = await inscrire();
    const bob = await inscrire();

    const creee = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: auth(alice.token),
      payload: { prompt: "un collier doré" },
    });
    const { generation } = creee.json();

    const vol = await app.inject({
      method: "GET",
      url: `/v1/generations/${generation.id}`,
      headers: auth(bob.token),
    });
    expect(vol.statusCode).toBe(404);

    const sienne = await app.inject({
      method: "GET",
      url: `/v1/generations/${generation.id}`,
      headers: auth(alice.token),
    });
    expect(sienne.statusCode).toBe(200);
  });

  it("n'annule pas la génération d'autrui", async () => {
    const alice = await inscrire();
    const bob = await inscrire();

    const creee = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: auth(alice.token),
      payload: { prompt: "un collier doré" },
    });
    const { generation } = creee.json();

    const r = await app.inject({
      method: "POST",
      url: `/v1/generations/${generation.id}/cancel`,
      headers: auth(bob.token),
    });
    expect(r.statusCode).toBe(409);
  });

  it("refuse un format d'image non supporté", async () => {
    const { token } = await inscrire();
    const r = await app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: auth(token),
      payload: { contentType: "application/x-msdownload", sizeBytes: 100 },
    });
    expect(r.statusCode).toBe(415);
  });

  it("refuse une image trop volumineuse", async () => {
    const { token } = await inscrire();
    const r = await app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: auth(token),
      payload: { contentType: "image/png", sizeBytes: 50 * 1024 * 1024 },
    });
    expect(r.statusCode).toBe(413);
  });

  it("ne liste que les actifs de l'appelant", async () => {
    const alice = await inscrire();
    const bob = await inscrire();

    await app.inject({
      method: "POST",
      url: "/v1/assets",
      headers: auth(alice.token),
      payload: { contentType: "image/png", sizeBytes: 1024 },
    });

    const liste = await app.inject({
      method: "GET",
      url: "/v1/assets",
      headers: auth(bob.token),
    });
    expect(liste.json().assets).toHaveLength(0);
  });
});
