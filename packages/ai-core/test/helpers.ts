import type { VideoModelProvider } from "../src/providers/VideoModelProvider.js";
import { supportsRequest } from "../src/providers/VideoModelProvider.js";
import type { ModelLicense } from "../src/registry/ModelRegistry.js";
import {
  GenerationError,
  type GenerationCost,
  type ModelCapabilities,
  type ModelHealth,
  type ModelHealthStatus,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "../src/types.js";

export const CAPABILITIES_DE_BASE: ModelCapabilities = {
  imageToVideo: true,
  textToVideo: true,
  nativeAudio: false,
  durations: [5, 10, 15],
  resolutions: ["720p", "1080p"],
  aspectRatios: ["9:16", "1:1", "16:9"],
  maxDurationSeconds: 15,
  qualityScore: 0.5,
  speedScore: 0.5,
  productConsistencyScore: 0.5,
  minimumVramGb: 24,
};

export const LICENCE_LIBRE: ModelLicense = {
  name: "Apache-2.0",
  sourceUrl: "https://example.invalid/licence",
  commercialAllowed: true,
  territorialRestrictions: [],
  attributionRequired: true,
  verifiedAt: "2026-10-07",
};

export const LICENCE_RESTREINTE: ModelLicense = {
  name: "Community License (restreinte)",
  sourceUrl: "https://example.invalid/licence-restreinte",
  commercialAllowed: false,
  territorialRestrictions: ["EU"],
  attributionRequired: true,
  verifiedAt: "2026-10-07",
  notes: "Usage commercial à vérifier juridiquement avant activation.",
};

export interface FakeProviderOptions {
  id: string;
  capabilities?: Partial<ModelCapabilities>;
  credits?: number;
  health?: ModelHealthStatus;
  costThrows?: boolean;
}

/** Provider contrôlable, pour piloter précisément les scénarios de routage. */
export class FakeProvider implements VideoModelProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities;

  private readonly credits: number;
  private readonly health: ModelHealthStatus;
  private readonly costThrows: boolean;

  constructor(options: FakeProviderOptions) {
    this.id = options.id;
    this.name = `Fake ${options.id}`;
    this.capabilities = { ...CAPABILITIES_DE_BASE, ...options.capabilities };
    this.credits = options.credits ?? 10;
    this.health = options.health ?? "healthy";
    this.costThrows = options.costThrows ?? false;
  }

  async generate(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResult> {
    if (!supportsRequest(this.capabilities, request)) {
      throw new GenerationError("UNSUPPORTED_REQUEST", "non supporté");
    }
    return {
      generationId: request.generationId,
      providerId: this.id,
      videoKey: `fake/${this.id}.mp4`,
      durationSeconds: request.durationSeconds,
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      seed: request.seed ?? 1,
      actualCost: await this.estimateCost(request),
      generationTimeMs: 1,
    };
  }

  async estimateCost(
    request: VideoGenerationRequest,
  ): Promise<GenerationCost> {
    if (this.costThrows) throw new Error("estimation indisponible");
    return {
      gpuSeconds: request.durationSeconds,
      usd: this.credits * 0.01,
      credits: this.credits,
    };
  }

  async healthCheck(): Promise<ModelHealth> {
    return { status: this.health, checkedAt: new Date(0) };
  }
}

export function requete(
  surcharges: Partial<VideoGenerationRequest> = {},
): VideoGenerationRequest {
  return {
    generationId: "gen_test",
    prompt: "un produit sur fond studio",
    productImageKey: "uploads/produit.jpg",
    durationSeconds: 10,
    resolution: "1080p",
    aspectRatio: "9:16",
    mode: "quality",
    ...surcharges,
  };
}
