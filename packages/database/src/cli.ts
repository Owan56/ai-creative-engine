#!/usr/bin/env node
/**
 * Applique les migrations. Point d'entrée de `npm run db:migrate`.
 */

import pg from "pg";
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absente. Copiez .env.example vers .env.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });
try {
  const { applied, skipped } = await migrate(pool);
  for (const nom of skipped) console.log(`  = ${nom} (déjà appliquée)`);
  for (const nom of applied) console.log(`  + ${nom}`);
  console.log(
    applied.length
      ? `${applied.length} migration(s) appliquée(s).`
      : "Base déjà à jour.",
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await pool.end();
}
