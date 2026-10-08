import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Chemins relatifs : le build fonctionne alors depuis n'importe quel
  // sous-dossier, pas seulement à la racine d'un domaine.
  base: "./",
  plugins: [react()],
  server: {
    port: 3000,
    // L'interface parle à l'API par un chemin relatif : aucune URL en dur,
    // donc le même code fonctionne en local et en production.
    proxy: { "/v1": { target: "http://localhost:3001", changeOrigin: true } },
  },
});
