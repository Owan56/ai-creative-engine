/**
 * Enregistrement de la vidéo produite comme actif de l'utilisateur.
 *
 * Pourquoi une fonction dédiée plutôt qu'un INSERT dans le câblage : la
 * colonne `assets.storage_key` est unique, et rien ne garantit qu'un moteur
 * renvoie une clé neuve à chaque appel. Un moteur qui met en cache, qui
 * renvoie un rendu déjà produit, ou qui pointe vers un fichier de référence
 * fait réapparaître la même clé — et l'INSERT échoue. La génération était
 * pourtant réussie : elle se terminait en `FAILED / INTERNAL`, avec un
 * message que l'utilisateur ne pouvait ni comprendre ni corriger.
 *
 * Constaté en exécutant deux générations de suite.
 */

import type { Pool } from "pg";

export class AssetKeyConflict extends Error {
  constructor(readonly storageKey: string) {
    super("Clé de stockage déjà utilisée par un autre compte.");
    this.name = "AssetKeyConflict";
  }
}

/**
 * Insère l'actif, ou réutilise celui que ce même utilisateur possède déjà
 * sous cette clé.
 *
 * La réutilisation est volontairement limitée au propriétaire : rendre
 * l'actif d'un autre compte reviendrait à lui livrer sa vidéo. Si la clé
 * appartient à quelqu'un d'autre, c'est une anomalie, et elle est signalée
 * comme telle plutôt que silencieusement contournée.
 */
export async function persistVideoAsset(
  pool: Pool,
  userId: string,
  storageKey: string,
  contentType = "video/mp4",
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assets (user_id, kind, storage_key, content_type, size_bytes)
     VALUES ($1, 'VIDEO', $2, $3, 0)
     ON CONFLICT (storage_key) DO NOTHING
     RETURNING id`,
    [userId, storageKey, contentType],
  );

  const insere = rows[0];
  if (insere) return insere.id;

  // Rien n'a été inséré : la clé existe déjà. Elle doit appartenir à cet
  // utilisateur, sinon on refuse.
  const { rows: existants } = await pool.query<{ id: string }>(
    `SELECT id FROM assets WHERE storage_key = $1 AND user_id = $2`,
    [storageKey, userId],
  );

  const existant = existants[0];
  if (!existant) throw new AssetKeyConflict(storageKey);
  return existant.id;
}
