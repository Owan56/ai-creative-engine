/**
 * Contrat que tout moteur vidéo doit respecter (cahier des charges §15).
 *
 * Ajouter un modèle = ajouter un fichier qui implémente cette interface,
 * plus une entrée dans le ModelRegistry. Rien d'autre dans l'application
 * ne doit changer (§119).
 */

import type {
  GenerationCost,
  ModelCapabilities,
  ModelHealth,
  VideoGenerationRequest,
  VideoGenerationResult,
} from "../types.js";

export interface VideoModelProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities;

  generate(request: VideoGenerationRequest): Promise<VideoGenerationResult>;

  estimateCost(request: VideoGenerationRequest): Promise<GenerationCost>;

  healthCheck(): Promise<ModelHealth>;

  /** Libère la VRAM. Optionnel : tous les backends n'en ont pas besoin. */
  unload?(): Promise<void>;
}

/**
 * Une requête est-elle réalisable par ce provider ?
 *
 * Centralisé ici pour que le routeur et les providers appliquent exactement
 * la même règle — une divergence produirait des échecs en cours de job.
 */
export function supportsRequest(
  capabilities: ModelCapabilities,
  request: VideoGenerationRequest,
): boolean {
  if (request.productImageKey && !capabilities.imageToVideo) return false;
  if (!request.productImageKey && !capabilities.textToVideo) return false;
  if (request.withAudio && !capabilities.nativeAudio) {
    // L'audio peut être ajouté en post-production (§54), donc ce n'est pas
    // bloquant : on laisse passer.
  }
  if (!capabilities.durations.includes(request.durationSeconds)) return false;
  if (request.durationSeconds > capabilities.maxDurationSeconds) return false;
  if (!capabilities.resolutions.includes(request.resolution)) return false;
  if (!capabilities.aspectRatios.includes(request.aspectRatio)) return false;
  return true;
}
