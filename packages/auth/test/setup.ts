/**
 * Applique les migrations avant la suite, avec le migrateur de production.
 *
 * Une base de test montée à la main finit par diverger du schéma réel et fait
 * passer des tests qui ne protègent plus rien — c'est exactement ce qui s'est
 * produit pendant le développement de ce module.
 */

import pg from "pg";
import { migrate } from "@ace/database";

export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
