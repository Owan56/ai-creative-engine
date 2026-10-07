/**
 * Provider factice (cahier des charges §40, §112).
 *
 * Permet de développer et de tester toute l'application — queue, crédits,
 * storage, UI — sans allumer un seul GPU. C'est le provider par défaut en
 * développement.
 */

import {
  GenerationError,
  type GenerationCost,
  type ModelCapabilities,
  type ModelHealth,
  type VideoGenerationRequest,
  type VideoGenerationResult,
} from "../types.js";
import { supportsRequest, type VideoModelProvider } from "./VideoModelProvider.js";

export interface MockProviderOptions {
  /** Clé de la vidéo de test renvoyée à chaque génération. */
  sampleVideoKey?: string;
  /** Latence simulée, pour voir l'UI de progression travailler. */
  latencyMs?: number;
  /** Taux d'échec simulé entre 0 et 1, pour tester les retries. */
  failureRate?: number;
  /** Source d'aléa injectable, pour rendre les tests déterministes. */
  random?: () => number;
  now?: () => number;
}

const CAPABILITIES: ModelCapabilities = {
  imageToVideo: true,
  textToVideo: true,
  nativeAudio: false,
  durations: [5, 6, 8, 10, 15, 20],
  resolutions: ["480p", "720p", "1080p"],
  aspectRatios: ["9:16", "1:1", "4:5", "16:9"],
  maxDurationSeconds: 20,
  qualityScore: 0.5,
  speedScore: 1,
  productConsistencyScore: 0.5,
  minimumVramGb: 0,
};

export class MockVideoProvider implements VideoModelProvider {
  readonly id = "mock";
  readonly name = "Mock Provider (développement)";
  readonly capabilities = CAPABILITIES;

  private readonly sampleVideoKey: string;
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(options: MockProviderOptions = {}) {
    this.sampleVideoKey = options.sampleVideoKey ?? "samples/mock-ad.mp4";
    this.latencyMs = options.latencyMs ?? 0;
    this.failureRate = options.failureRate ?? 0;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  async generate(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationResult> {
    if (!supportsRequest(this.capabilities, request)) {
      throw new GenerationError(
        "UNSUPPORTED_REQUEST",
        `Requête non supportée par ${this.id}.`,
      );
    }

    const debut = this.now();
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }

    if (this.failureRate > 0 && this.random() < this.failureRate) {
      throw new GenerationError(
        "INTERNAL",
        "Échec simulé par le mock provider.",
        true,
      );
    }

    return {
      generationId: request.generationId,
      providerId: this.id,
      videoKey: this.sampleVideoKey,
      durationSeconds: request.durationSeconds,
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      seed: request.seed ?? Math.floor(this.random() * 2 ** 31),
      actualCost: await this.estimateCost(request),
      generationTimeMs: Math.max(0, this.now() - debut),
    };
  }

  async estimateCost(
    request: VideoGenerationRequest,
  ): Promise<GenerationCost> {
    return { gpuSeconds: request.durationSeconds, usd: 0, credits: 0 };
  }

  async healthCheck(): Promise<ModelHealth> {
    return { status: "healthy", checkedAt: new Date(this.now()) };
  }
}
