/**
 * Construit le registre depuis la configuration (§17, §41, §113).
 *
 * C'est le seul endroit où l'on décide quel moteur existe. Ajouter un modèle
 * se limite à une entrée ici plus son fichier de provider (§119).
 */

import { FalProvider } from "../providers/FalProvider.js";
import { LTXProvider } from "../providers/LTXProvider.js";
import { MockVideoProvider } from "../providers/MockVideoProvider.js";
import { ModelRegistry, type ModelLicense } from "./ModelRegistry.js";

export const LICENCES: Readonly<Record<string, ModelLicense>> = {
  mock: {
    name: "Interne",
    sourceUrl: "https://github.com/Owan56/ai-creative-engine",
    commercialAllowed: true,
    territorialRestrictions: [],
    attributionRequired: false,
    verifiedAt: "2026-10-08",
  },
  fal: {
    name: "Service hébergé — conditions du fournisseur",
    sourceUrl: "https://fal.ai/terms",
    // L'exploitation commerciale est le but même du service, et le
    // fournisseur gère la licence du modèle qu'il héberge.
    commercialAllowed: true,
    territorialRestrictions: [],
    attributionRequired: false,
    verifiedAt: "2026-10-08",
  },
  ltx: {
    name: "À VÉRIFIER avant toute exploitation commerciale",
    sourceUrl: "https://github.com/Lightricks/LTX-Video",
    // Volontairement faux : le registre refuse alors de le sélectionner.
    // À passer à vrai seulement après lecture de la licence courante et
    // validation juridique du territoire (docs/models.md).
    commercialAllowed: false,
    territorialRestrictions: [],
    attributionRequired: true,
    verifiedAt: "2026-10-08",
    notes: "Licence non vérifiée. Voir docs/models.md avant activation.",
  },
};

export interface BootstrapConfig {
  /** Clé fal.ai. Présente, le moteur hébergé est disponible. */
  readonly falApiKey?: string;
  /** `mock` en développement, `router` en production (§113). */
  readonly videoProvider?: string;
  readonly ltxEnabled?: boolean;
  /** Endpoint ComfyUI de l'instance GPU, fourni par le worker. */
  readonly ltxEndpoint?: string;
  readonly ltxCommercialVerified?: boolean;
}

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): BootstrapConfig {
  return {
    videoProvider: env.VIDEO_PROVIDER ?? "mock",
    ...(env.FAL_KEY ? { falApiKey: env.FAL_KEY } : {}),
    ltxEnabled: env.LTX_ENABLED === "true",
    ...(env.LTX_ENDPOINT ? { ltxEndpoint: env.LTX_ENDPOINT } : {}),
    ltxCommercialVerified: env.LTX_COMMERCIAL_VERIFIED === "true",
  };
}

export function buildRegistry(config: BootstrapConfig = {}): ModelRegistry {
  const registre = new ModelRegistry();

  // Le mock est toujours enregistré : il sert de secours en développement et
  // rend l'application démarrable sans aucun GPU (§112).
  registre.register(new MockVideoProvider(), LICENCES.mock!, {
    enabled: config.videoProvider !== "router",
    priority: -100,
  });

  // Moteur hébergé : aucune infrastructure, facturé à la seconde produite.
  // C'est le moteur de lancement, avant qu'un GPU propre ne devienne rentable.
  if (config.falApiKey) {
    registre.register(
      new FalProvider({ apiKey: config.falApiKey }),
      LICENCES.fal!,
      { enabled: true, priority: 5 },
    );
  }

  if (config.ltxEnabled && config.ltxEndpoint) {
    registre.register(
      new LTXProvider({ endpoint: config.ltxEndpoint }),
      {
        ...LICENCES.ltx!,
        // Deux verrous distincts : activer le moteur ne suffit pas, il faut
        // aussi avoir confirmé la licence.
        commercialAllowed: config.ltxCommercialVerified === true,
      },
      { enabled: true, priority: 10 },
    );
  }

  return registre;
}
