/**
 * Tests du système de crédits, contre un vrai PostgreSQL.
 *
 * Les scénarios de concurrence (§105) n'ont aucune valeur contre un double :
 * c'est le moteur de base qui fournit la garantie, donc c'est lui qu'on teste.
 *
 * Nécessite DATABASE_URL. Sans elle, la suite est ignorée plutôt que de
 * passer en silence avec des mocks trompeurs.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { CreditError, CreditService } from "../src/CreditService.js";

const DATABASE_URL = process.env.DATABASE_URL;
const decrire = DATABASE_URL ? describe : describe.skip;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const service = new CreditService(pool);

afterAll(async () => {
  await pool.end().catch(() => {});
});

async function creerUtilisateur(credits = 0): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`test-${crypto.randomUUID()}@example.invalid`],
  );
  const userId = rows[0]!.id;
  await service.createAccount(userId);
  if (credits > 0) await service.grant(userId, credits);
  return userId;
}

decrire("CreditService", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
  });

  it("débite exactement le montant réservé (§105)", async () => {
    const userId = await creerUtilisateur(100);

    const reservation = await service.reserve(userId, crypto.randomUUID(), 15);
    // Pendant la génération, les crédits sont gelés mais pas encore débités.
    expect(await service.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 15,
      available: 85,
    });

    await service.consume(reservation.id);
    expect(await service.getBalance(userId)).toMatchObject({
      balance: 85,
      reserved: 0,
      available: 85,
    });
  });

  it("empêche le double débit d'une même réservation (§105)", async () => {
    const userId = await creerUtilisateur(100);
    const reservation = await service.reserve(userId, crypto.randomUUID(), 15);

    // Deux workers règlent la même réservation en même temps.
    const resultats = await Promise.allSettled([
      service.consume(reservation.id),
      service.consume(reservation.id),
    ]);

    const reussites = resultats.filter((r) => r.status === "fulfilled");
    const echecs = resultats.filter((r) => r.status === "rejected");

    expect(reussites).toHaveLength(1);
    expect(echecs).toHaveLength(1);
    expect((echecs[0] as PromiseRejectedResult).reason).toBeInstanceOf(CreditError);

    // Le solde n'a été débité qu'une fois.
    expect((await service.getBalance(userId)).balance).toBe(85);
  });

  it("sérialise deux réservations concurrentes sur le même solde", async () => {
    const userId = await creerUtilisateur(100);

    // On retient la première transaction dans sa section critique. La seconde
    // vient alors buter sur le verrou de ligne, ce qui est exactement la
    // contention qu'on veut éprouver — sans ce délai, les deux appels
    // s'enchaînent trop vite pour se rencontrer.
    let premiere = true;
    const concurrent = new CreditService(pool, {
      beforeReserveWrite: async () => {
        if (!premiere) return;
        premiere = false;
        await new Promise((r) => setTimeout(r, 300));
      },
    });

    // 60 + 60 > 100 : une seule des deux doit aboutir.
    const resultats = await Promise.allSettled([
      concurrent.reserve(userId, crypto.randomUUID(), 60),
      concurrent.reserve(userId, crypto.randomUUID(), 60),
    ]);

    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const refuses = resultats.filter((r) => r.status === "rejected");
    expect(refuses).toHaveLength(1);
    // Une erreur métier, jamais une violation de contrainte Postgres brute :
    // celle-ci remonterait telle quelle jusqu'à l'API.
    expect((refuses[0] as PromiseRejectedResult).reason).toBeInstanceOf(CreditError);
    expect((refuses[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });

    const solde = await service.getBalance(userId);
    expect(solde).toMatchObject({ balance: 100, reserved: 60, available: 40 });
  });

  it("la base refuse un découvert même si le code applicatif se trompe", async () => {
    const userId = await creerUtilisateur(100);

    // Dernière ligne de défense : on écrit directement en base, en court-
    // circuitant tout le service. Aucun bug applicatif, aucune course, aucune
    // régression future ne doit pouvoir produire reserved > balance.
    await expect(
      pool.query(
        `UPDATE credit_accounts SET reserved = 120 WHERE user_id = $1`,
        [userId],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "credit_accounts_reserved_within_balance",
    });

    await expect(
      pool.query(
        `UPDATE credit_accounts SET balance = -1 WHERE user_id = $1`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    expect(await service.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 0,
    });
  });

  it("rend les crédits quand la génération échoue (§106)", async () => {
    const userId = await creerUtilisateur(100);
    const reservation = await service.reserve(userId, crypto.randomUUID(), 15);

    // Le GPU tombe en cours de route.
    await service.release(reservation.id, "FAILED");

    expect(await service.getBalance(userId)).toMatchObject({
      balance: 100,
      reserved: 0,
      available: 100,
    });
  });

  it("refuse de régler deux fois une réservation déjà libérée", async () => {
    const userId = await creerUtilisateur(100);
    const reservation = await service.reserve(userId, crypto.randomUUID(), 15);

    await service.release(reservation.id);
    await expect(service.consume(reservation.id)).rejects.toMatchObject({
      code: "RESERVATION_ALREADY_SETTLED",
    });
    expect((await service.getBalance(userId)).balance).toBe(100);
  });

  it("refuse une réservation au-delà du solde disponible (§82)", async () => {
    const userId = await creerUtilisateur(10);

    await expect(
      service.reserve(userId, crypto.randomUUID(), 15),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });

    expect(await service.getBalance(userId)).toMatchObject({
      reserved: 0,
      available: 10,
    });
  });

  it("refuse deux réservations pour la même génération", async () => {
    const userId = await creerUtilisateur(100);
    const generationId = crypto.randomUUID();

    await service.reserve(userId, generationId, 15);
    await expect(
      service.reserve(userId, generationId, 15),
    ).rejects.toMatchObject({ code: "DUPLICATE_RESERVATION" });

    expect((await service.getBalance(userId)).reserved).toBe(15);
  });

  it("ne crédite qu'une fois un webhook rejoué (§109)", async () => {
    const userId = await creerUtilisateur();
    const cle = `stripe_evt_${crypto.randomUUID()}`;

    await service.grant(userId, 300, { kind: "PURCHASE", idempotencyKey: cle });
    await service.grant(userId, 300, { kind: "PURCHASE", idempotencyKey: cle });

    expect((await service.getBalance(userId)).balance).toBe(300);
  });

  it("résiste à un webhook rejoué en parallèle", async () => {
    const userId = await creerUtilisateur();
    const cle = `stripe_evt_${crypto.randomUUID()}`;

    // Stripe réémet parfois avant que le premier traitement ait commité.
    await Promise.allSettled([
      service.grant(userId, 300, { kind: "PURCHASE", idempotencyKey: cle }),
      service.grant(userId, 300, { kind: "PURCHASE", idempotencyKey: cle }),
    ]);

    expect((await service.getBalance(userId)).balance).toBe(300);
  });

  it("ne débite jamais plus que le montant réservé", async () => {
    const userId = await creerUtilisateur(100);
    const reservation = await service.reserve(userId, crypto.randomUUID(), 15);

    // Le worker rapporte un coût réel supérieur à l'estimation : l'utilisateur
    // ne doit pas payer au-delà de ce qu'il a accepté.
    await service.consume(reservation.id, 40);

    expect((await service.getBalance(userId)).balance).toBe(85);
  });

  it("débite moins que réservé si la génération a coûté moins", async () => {
    const userId = await creerUtilisateur(100);
    const reservation = await service.reserve(userId, crypto.randomUUID(), 15);

    await service.consume(reservation.id, 9);

    expect(await service.getBalance(userId)).toMatchObject({
      balance: 91,
      reserved: 0,
    });
  });

  it("tient sous une rafale de générations concurrentes", async () => {
    const userId = await creerUtilisateur(100);

    // 20 tentatives à 15 crédits : au plus 6 peuvent passer (90 ≤ 100).
    const resultats = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.reserve(userId, crypto.randomUUID(), 15),
      ),
    );

    const acceptees = resultats.filter((r) => r.status === "fulfilled").length;
    expect(acceptees).toBe(6);

    const solde = await service.getBalance(userId);
    expect(solde.reserved).toBe(90);
    expect(solde.available).toBe(10);
    expect(solde.available).toBeGreaterThanOrEqual(0);
  });
});
