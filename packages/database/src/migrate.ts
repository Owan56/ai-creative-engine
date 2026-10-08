/**
 * Applique les migrations SQL dans l'ordre, une seule fois chacune.
 *
 * Volontairement minimal : un suivi des migrations déjà appliquées, une
 * transaction par fichier. Pas de rollback automatique — en production une
 * migration descendante se décide, elle ne s'improvise pas.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export function listMigrations(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function migrate(
  pool: Pool,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const nom of listMigrations(dir)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verrouille la ligne de suivi : deux instances qui démarrent ensemble
      // ne doivent pas appliquer la même migration deux fois.
      const { rows } = await client.query(
        `SELECT name FROM schema_migrations WHERE name = $1 FOR UPDATE`,
        [nom],
      );

      if (rows.length > 0) {
        await client.query("COMMIT");
        skipped.push(nom);
        continue;
      }

      await client.query(readFileSync(join(dir, nom), "utf8"));
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [nom],
      );
      await client.query("COMMIT");
      applied.push(nom);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(
        `Migration ${nom} échouée : ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}
