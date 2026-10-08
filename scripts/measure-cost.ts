#!/usr/bin/env tsx
/**
 * Mesure le coût réel d'une génération et le confronte à la grille tarifaire.
 *
 *     npx tsx scripts/measure-cost.ts --endpoint http://<pod>:8188
 *
 * Lance une vraie génération LTX sur un ComfyUI déjà démarré, chronomètre, et
 * calcule si les plans sont rentables. Ce chiffre doit exister AVANT d'ouvrir
 * les inscriptions.
 */

import { LTXProvider } from "../packages/ai-core/src/providers/LTXProvider.js";
import type { VideoGenerationRequest } from "../packages/ai-core/src/types.js";

function arg(nom: string, defaut?: string): string {
  const i = process.argv.indexOf(`--${nom}`);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  if (!v && defaut === undefined) {
    console.error(`Argument --${nom} manquant.`);
    process.exit(1);
  }
  return v ?? defaut!;
}

const endpoint = arg("endpoint");
const usdPerHour = Number(arg("usd-per-hour", "0.44"));
const duree = Number(arg("duration", "10"));
const resolution = arg("resolution", "720p") as VideoGenerationRequest["resolution"];

// Grille actuelle (§91). À confronter au coût mesuré.
const PLANS = [
  { nom: "PRO", euros: 19.9, credits: 300 },
  { nom: "CREATOR", euros: 39.9, credits: 800 },
  { nom: "AGENCY", euros: 79.9, credits: 2000 },
];
const EUR_PAR_USD = 0.92;

const provider = new LTXProvider({
  endpoint,
  usdPerGpuSecond: usdPerHour / 3600,
});

const request: VideoGenerationRequest = {
  generationId: crypto.randomUUID(),
  prompt:
    "A gold pendant necklace on a dark marble surface, slow camera push-in, " +
    "soft studio lighting, shallow depth of field, premium product film",
  durationSeconds: duree,
  resolution,
  aspectRatio: "9:16",
  mode: "product",
  seed: 42,
};

console.log(`Endpoint   : ${endpoint}`);
console.log(`Génération : ${duree}s en ${resolution}`);

const sante = await provider.healthCheck();
if (sante.status === "unavailable") {
  console.error(`\nComfyUI injoignable : ${sante.detail ?? ""}`);
  console.error("Vérifie que le pod tourne et que le port 8188 est exposé.");
  process.exit(1);
}

const estime = await provider.estimateCost(request);
console.log(`Estimation : ${estime.gpuSeconds}s GPU, ${estime.credits} crédits\n`);
console.log("Génération en cours (plusieurs minutes au premier appel,");
console.log("le modèle doit être chargé en VRAM)...\n");

const debut = Date.now();
let reel: { gpuSeconds: number; usd: number; credits: number };
try {
  const resultat = await provider.generate(request);
  reel = resultat.actualCost;
} catch (err) {
  console.error(`\nÉchec : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const secondes = (Date.now() - debut) / 1000;
const usdReel = (secondes / 3600) * usdPerHour;

console.log("═══ MESURE RÉELLE ═══");
console.log(`  temps GPU      : ${secondes.toFixed(1)} s`);
console.log(`  coût           : $${usdReel.toFixed(4)}`);
console.log(`  écart / estim. : ×${(secondes / estime.gpuSeconds).toFixed(2)}`);

if (secondes > estime.gpuSeconds * 1.3 || secondes < estime.gpuSeconds * 0.7) {
  console.log(`\n  ⚠ estimateCost() est à recaler : l'écart dépasse 30 %.`);
  console.log(`    Facteur à appliquer : ×${(secondes / estime.gpuSeconds).toFixed(2)}`);
}

console.log("\n═══ RENTABILITÉ DES PLANS ═══");
const creditsParGeneration = reel.credits || estime.credits;

for (const plan of PLANS) {
  const generations = Math.floor(plan.credits / creditsParGeneration);
  const coutTotal = generations * usdReel * EUR_PAR_USD;
  // Stripe prélève environ 1,5 % + 0,25 € sur une carte européenne.
  const fraisPaiement = plan.euros * 0.015 + 0.25;
  const marge = plan.euros - coutTotal - fraisPaiement;
  const pct = (marge / plan.euros) * 100;
  const verdict = marge < 0 ? "PERTE" : pct < 30 ? "marge faible" : "OK";

  console.log(
    `  ${plan.nom.padEnd(8)} ${String(generations).padStart(4)} générations  ` +
      `coût ${coutTotal.toFixed(2)} €  marge ${marge.toFixed(2)} € ` +
      `(${pct.toFixed(0)} %)  ${verdict}`,
  );
}

console.log("\nLa marge suppose un abonné qui consomme TOUS ses crédits.");
console.log("En pratique beaucoup n'en utilisent qu'une part, ce qui améliore");
console.log("le résultat réel — mais dimensionner sur le pire cas est plus sûr.");
