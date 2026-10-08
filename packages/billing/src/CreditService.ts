/**
 * Système de crédits transactionnel (cahier des charges §31, §105, §106, §109).
 *
 * Cycle de vie d'une génération :
 *
 *     reserve(15)  →  génération  →  consume()   solde -15
 *                                 ↘  release()   solde inchangé
 *
 * Trois garanties, toutes tenues par la base et non par ce code :
 *
 * 1. Pas de double réservation — `generation_id` est UNIQUE.
 * 2. Pas de double débit — la transition HELD → CONSUMED est conditionnelle
 *    et vérifiée par le nombre de lignes affectées.
 * 3. Pas de solde négatif — contraintes CHECK sur `credit_accounts`.
 *
 * La garantie de fond contre le dépassement de solde est la contrainte
 * `CHECK (reserved <= balance)` : même sans verrou applicatif, PostgreSQL
 * rejette l'UPDATE qui déborde. Le `SELECT ... FOR UPDATE` sérialise en
 * amont pour que l'appelant reçoive une erreur métier propre plutôt qu'une
 * violation de contrainte brute. Les deux sont conservés : la contrainte
 * pour la correction, le verrou pour la qualité du message.
 *
 * Vérifié par mutation : retirer la contrainte CHECK, ou la clause
 * `AND status = 'HELD'`, fait tomber les tests correspondants.
 */

/**
 * Point d'interception réservé aux tests.
 *
 * Deux appels concurrents à `reserve()` s'exécutent en pratique si vite que
 * le second lit déjà le solde mis à jour par le premier — l'entrelacement
 * dangereux ne se produit jamais spontanément. Ce crochet permet à un test
 * de bloquer entre la lecture et l'écriture pour reproduire la course réelle.
 *
 * Il n'est jamais fourni en production.
 */
export interface CreditServiceHooks {
  readonly beforeReserveWrite?: () => Promise<void>;
}

import type { Pool, PoolClient } from "pg";

export type ReservationStatus = "HELD" | "CONSUMED" | "RELEASED";

export interface CreditBalance {
  readonly balance: number;
  readonly reserved: number;
  /** Ce que l'utilisateur peut réellement engager maintenant. */
  readonly available: number;
}

export interface Reservation {
  readonly id: string;
  readonly userId: string;
  readonly generationId: string;
  readonly credits: number;
  readonly status: ReservationStatus;
}

export type CreditErrorCode =
  | "INSUFFICIENT_CREDITS"
  | "ACCOUNT_NOT_FOUND"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_ALREADY_SETTLED"
  | "DUPLICATE_RESERVATION"
  | "INVALID_AMOUNT";

export class CreditError extends Error {
  constructor(
    readonly code: CreditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreditError";
  }
}

export class CreditService {
  constructor(
    private readonly pool: Pool,
    private readonly hooks: CreditServiceHooks = {},
  ) {}

  async createAccount(userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO credit_accounts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
  }

  async getBalance(userId: string): Promise<CreditBalance> {
    const { rows } = await this.pool.query<{ balance: number; reserved: number }>(
      `SELECT balance, reserved FROM credit_accounts WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) {
      throw new CreditError("ACCOUNT_NOT_FOUND", `Compte introuvable : ${userId}`);
    }
    return {
      balance: row.balance,
      reserved: row.reserved,
      available: row.balance - row.reserved,
    };
  }

  /**
   * Crédite le compte. `idempotencyKey` rend l'opération rejouable sans
   * risque — un webhook Stripe reçu deux fois ne crédite qu'une fois (§109).
   */
  async grant(
    userId: string,
    credits: number,
    options: {
      kind?: "GRANT" | "PURCHASE" | "ADJUST";
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<CreditBalance> {
    if (!Number.isInteger(credits) || credits <= 0) {
      throw new CreditError("INVALID_AMOUNT", "Le montant doit être un entier positif.");
    }

    return this.inTransaction(async (client) => {
      if (options.idempotencyKey) {
        const { rows } = await client.query(
          `SELECT 1 FROM credit_transactions WHERE idempotency_key = $1`,
          [options.idempotencyKey],
        );
        // Déjà traité : on ne recrédite pas, on renvoie l'état courant.
        if (rows.length > 0) return this.lockedBalance(client, userId);
      }

      const compte = await this.lockAccount(client, userId);
      const nouveauSolde = compte.balance + credits;

      await client.query(
        `UPDATE credit_accounts
            SET balance = $2, updated_at = now()
          WHERE user_id = $1`,
        [userId, nouveauSolde],
      );

      await client.query(
        `INSERT INTO credit_transactions
           (user_id, kind, amount, balance_after, idempotency_key, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          options.kind ?? "GRANT",
          credits,
          nouveauSolde,
          options.idempotencyKey ?? null,
          JSON.stringify(options.metadata ?? {}),
        ],
      );

      return {
        balance: nouveauSolde,
        reserved: compte.reserved,
        available: nouveauSolde - compte.reserved,
      };
    });
  }

  /**
   * Gèle des crédits avant de lancer un job GPU (§82).
   *
   * Aucun job coûteux ne doit partir sans réservation préalable réussie.
   */
  async reserve(
    userId: string,
    generationId: string,
    credits: number,
    options: { expiresAt?: Date } = {},
  ): Promise<Reservation> {
    if (!Number.isInteger(credits) || credits <= 0) {
      throw new CreditError("INVALID_AMOUNT", "Le montant doit être un entier positif.");
    }

    return this.inTransaction(async (client) => {
      const compte = await this.lockAccount(client, userId);
      const disponible = compte.balance - compte.reserved;

      if (disponible < credits) {
        throw new CreditError(
          "INSUFFICIENT_CREDITS",
          `Crédits insuffisants : ${disponible} disponibles, ${credits} demandés.`,
        );
      }

      await this.hooks.beforeReserveWrite?.();

      let reservationId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO credit_reservations
             (user_id, generation_id, credits, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [userId, generationId, credits, options.expiresAt ?? null],
        );
        reservationId = rows[0]!.id;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new CreditError(
            "DUPLICATE_RESERVATION",
            `La génération ${generationId} a déjà une réservation.`,
          );
        }
        throw err;
      }

      try {
        await client.query(
          `UPDATE credit_accounts
              SET reserved = reserved + $2, updated_at = now()
            WHERE user_id = $1`,
          [userId, credits],
        );
      } catch (err) {
        if (isBalanceCheckViolation(err)) {
          throw new CreditError(
            "INSUFFICIENT_CREDITS",
            "Crédits insuffisants : une autre génération vient de les engager.",
          );
        }
        throw err;
      }

      return {
        id: reservationId,
        userId,
        generationId,
        credits,
        status: "HELD" as const,
      };
    });
  }

  /**
   * Confirme la dépense après une génération réussie.
   *
   * `actualCredits` permet de débiter moins que réservé — jamais plus :
   * l'utilisateur ne peut pas être facturé au-delà de ce qu'il a accepté.
   */
  async consume(
    reservationId: string,
    actualCredits?: number,
  ): Promise<CreditBalance> {
    return this.inTransaction(async (client) => {
      const reservation = await this.settleReservation(
        client,
        reservationId,
        "CONSUMED",
      );

      const debit =
        actualCredits === undefined
          ? reservation.credits
          : Math.min(actualCredits, reservation.credits);

      if (!Number.isInteger(debit) || debit < 0) {
        throw new CreditError("INVALID_AMOUNT", "Montant débité invalide.");
      }

      const compte = await this.lockAccount(client, reservation.user_id);
      const nouveauSolde = compte.balance - debit;

      await client.query(
        `UPDATE credit_accounts
            SET balance = $2,
                reserved = reserved - $3,
                updated_at = now()
          WHERE user_id = $1`,
        [reservation.user_id, nouveauSolde, reservation.credits],
      );

      await client.query(
        `INSERT INTO credit_transactions
           (user_id, kind, amount, balance_after, reservation_id)
         VALUES ($1, 'CONSUME', $2, $3, $4)`,
        [reservation.user_id, -debit, nouveauSolde, reservationId],
      );

      return {
        balance: nouveauSolde,
        reserved: compte.reserved - reservation.credits,
        available: nouveauSolde - (compte.reserved - reservation.credits),
      };
    });
  }

  /**
   * Libère les crédits d'une génération échouée ou annulée (§106).
   * Le solde revient à son état d'avant la réservation.
   */
  async release(
    reservationId: string,
    reason: "FAILED" | "CANCELLED" | "EXPIRED" = "FAILED",
  ): Promise<CreditBalance> {
    return this.inTransaction(async (client) => {
      const reservation = await this.settleReservation(
        client,
        reservationId,
        "RELEASED",
      );

      const compte = await this.lockAccount(client, reservation.user_id);

      await client.query(
        `UPDATE credit_accounts
            SET reserved = reserved - $2, updated_at = now()
          WHERE user_id = $1`,
        [reservation.user_id, reservation.credits],
      );

      await client.query(
        `INSERT INTO credit_transactions
           (user_id, kind, amount, balance_after, reservation_id, metadata)
         VALUES ($1, $2, 0, $3, $4, $5)`,
        [
          reservation.user_id,
          reason === "EXPIRED" ? "EXPIRE" : "RELEASE",
          compte.balance,
          reservationId,
          JSON.stringify({ reason }),
        ],
      );

      return {
        balance: compte.balance,
        reserved: compte.reserved - reservation.credits,
        available: compte.balance - (compte.reserved - reservation.credits),
      };
    });
  }

  // ------------------------------------------------------------ internes

  /**
   * Fait passer une réservation de HELD à son état final.
   *
   * La clause `WHERE status = 'HELD'` est ce qui empêche le double débit :
   * deux workers qui règlent la même réservation, le second ne modifie
   * aucune ligne et reçoit une erreur.
   */
  private async settleReservation(
    client: PoolClient,
    reservationId: string,
    cible: "CONSUMED" | "RELEASED",
  ): Promise<{ user_id: string; credits: number }> {
    const { rows } = await client.query<{ user_id: string; credits: number }>(
      `UPDATE credit_reservations
          SET status = $2, settled_at = now()
        WHERE id = $1 AND status = 'HELD'
        RETURNING user_id, credits`,
      [reservationId, cible],
    );

    const reservation = rows[0];
    if (reservation) return reservation;

    const { rows: existantes } = await client.query(
      `SELECT 1 FROM credit_reservations WHERE id = $1`,
      [reservationId],
    );

    throw existantes.length > 0
      ? new CreditError(
          "RESERVATION_ALREADY_SETTLED",
          `Réservation ${reservationId} déjà réglée.`,
        )
      : new CreditError(
          "RESERVATION_NOT_FOUND",
          `Réservation introuvable : ${reservationId}`,
        );
  }

  private async lockAccount(
    client: PoolClient,
    userId: string,
  ): Promise<{ balance: number; reserved: number }> {
    const { rows } = await client.query<{ balance: number; reserved: number }>(
      `SELECT balance, reserved FROM credit_accounts
        WHERE user_id = $1
        FOR UPDATE`,
      [userId],
    );
    const compte = rows[0];
    if (!compte) {
      throw new CreditError("ACCOUNT_NOT_FOUND", `Compte introuvable : ${userId}`);
    }
    return compte;
  }

  private async lockedBalance(
    client: PoolClient,
    userId: string,
  ): Promise<CreditBalance> {
    const compte = await this.lockAccount(client, userId);
    return {
      balance: compte.balance,
      reserved: compte.reserved,
      available: compte.balance - compte.reserved,
    };
  }

  private async inTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const resultat = await fn(client);
      await client.query("COMMIT");
      return resultat;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Une violation de `credit_accounts_reserved_within_balance` signifie qu'une
 * transaction concurrente a consommé le solde entre notre lecture et notre
 * écriture. C'est un solde insuffisant, pas une panne : on le dit ainsi.
 */
function isBalanceCheckViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  return (
    e.code === "23514" &&
    e.constraint === "credit_accounts_reserved_within_balance"
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}
