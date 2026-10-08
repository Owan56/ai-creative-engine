import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/setup.ts"],
    // Les suites partagent une base PostgreSQL et tronquent les tables entre
    // les cas. En parallèle, le nettoyage d'un fichier efface les données
    // d'un autre en pleine exécution — on sérialise donc les fichiers.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
