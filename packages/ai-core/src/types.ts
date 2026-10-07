/**
 * Types partagés du moteur créatif.
 *
 * Règle d'architecture (cahier des charges §15, §80) : aucun code hors de
 * `providers/` ne doit connaître LTX, Wan ou Hunyuan. Tout passe par ces types.
 */

// ---------------------------------------------------------------- domaine

export type AspectRatio = "9:16" | "1:1" | "4:5" | "16:9";

export type Platform =
  | "tiktok"
  | "instagram_reels"
  | "instagram_feed"
  | "facebook"
  | "youtube_shorts"
  | "youtube";

export type Objective =
  | "conversion"
  | "awareness"
  | "product_launch"
  | "retargeting"
  | "engagement"
  | "ugc"
  | "luxury"
  | "streetwear"
  | "promotional";

export type Style =
  | "cinematic"
  | "luxury"
  | "streetwear"
  | "ugc"
  | "product_studio"
  | "futuristic"
  | "lifestyle";

/** Modes utilisateur du cahier des charges §19. */
export type GenerationMode =
  | "fast"
  | "quality"
  | "cinematic"
  | "product"
  | "premium";

export type Resolution = "480p" | "720p" | "1080p" | "4k";

// ---------------------------------------------------------------- capacités

export interface ModelCapabilities {
  imageToVideo: boolean;
  textToVideo: boolean;
  nativeAudio: boolean;
  /** Durées réellement supportées, en secondes (§12). */
  durations: readonly number[];
  resolutions: readonly Resolution[];
  aspectRatios: readonly AspectRatio[];
  maxDurationSeconds: number;
  /** Scores de référence sur 0..1, servant au routage (§20). */
  qualityScore: number;
  speedScore: number;
  productConsistencyScore: number;
  /** VRAM minimale en Go, pour le dimensionnement GPU. */
  minimumVramGb: number;
}

// ---------------------------------------------------------------- requêtes

export interface VideoGenerationRequest {
  readonly generationId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  /** Référence de l'image produit dans le storage (jamais un chemin local). */
  readonly productImageKey?: string;
  readonly durationSeconds: number;
  readonly resolution: Resolution;
  readonly aspectRatio: AspectRatio;
  readonly seed?: number;
  readonly mode: GenerationMode;
  readonly withAudio?: boolean;
}

export interface GenerationCost {
  /** Secondes de GPU estimées. */
  readonly gpuSeconds: number;
  /** Coût en dollars pour l'exploitant. */
  readonly usd: number;
  /** Coût facturé à l'utilisateur, en crédits (§31). */
  readonly credits: number;
}

export interface VideoGenerationResult {
  readonly generationId: string;
  readonly providerId: string;
  /** Clé de l'objet vidéo dans le storage. */
  readonly videoKey: string;
  readonly durationSeconds: number;
  readonly resolution: Resolution;
  readonly aspectRatio: AspectRatio;
  readonly seed: number;
  readonly actualCost: GenerationCost;
  readonly generationTimeMs: number;
}

export type ModelHealthStatus = "healthy" | "degraded" | "unavailable";

export interface ModelHealth {
  readonly status: ModelHealthStatus;
  readonly detail?: string;
  readonly checkedAt: Date;
}

// ---------------------------------------------------------------- erreurs

export type GenerationErrorCode =
  | "UNSUPPORTED_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "GPU_UNAVAILABLE"
  | "TIMEOUT"
  | "QUALITY_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export class GenerationError extends Error {
  constructor(
    readonly code: GenerationErrorCode,
    message: string,
    /** Vrai si un autre provider ou un retry a une chance d'aboutir (§53, §81). */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}
