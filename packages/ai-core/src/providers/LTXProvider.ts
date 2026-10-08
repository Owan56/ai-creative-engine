/**
 * Provider LTX (cahier des charges §118).
 *
 * Exécute LTX via un workflow ComfyUI officiel. L'application métier ne
 * connaît pas ce workflow : elle appelle `generate()` comme pour n'importe
 * quel autre moteur.
 *
 * ⚠️ Le GPU n'est pas alloué ici. Le worker provisionne l'instance via
 * `GPUBackend` et passe son endpoint. Ainsi le provider reste testable sans
 * GPU, et le fournisseur GPU reste interchangeable.
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
import { ComfyError, ComfyUIClient } from "./ComfyUIClient.js";

const CAPABILITIES: ModelCapabilities = {
  imageToVideo: true,
  textToVideo: true,
  nativeAudio: false,
  durations: [5, 6, 8, 10],
  resolutions: ["480p", "720p", "1080p"],
  aspectRatios: ["9:16", "1:1", "4:5", "16:9"],
  maxDurationSeconds: 10,
  // Scores provisoires. À recaler sur des mesures réelles dès les premières
  // générations : ils pilotent le routage, donc une valeur fausse envoie le
  // trafic au mauvais moteur.
  qualityScore: 0.82,
  speedScore: 0.75,
  productConsistencyScore: 0.8,
  minimumVramGb: 24,
};

const DIMENSIONS: Record<string, Record<string, [number, number]>> = {
  "480p": { "9:16": [480, 854], "1:1": [480, 480], "4:5": [480, 600], "16:9": [854, 480] },
  "720p": { "9:16": [720, 1280], "1:1": [720, 720], "4:5": [720, 900], "16:9": [1280, 720] },
  "1080p": { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] },
};

/** Contraintes connues des modèles vidéo : artefacts à écarter (§100). */
export const NEGATIF_PAR_DEFAUT =
  "deformed product, wrong logo, extra objects, duplicate product, " +
  "warped geometry, bad hands, text artifacts, camera jitter, flickering, " +
  "unwanted transformation, blurry, low quality";

export interface LTXOptions {
  /** Endpoint ComfyUI de l'instance GPU allouée par le worker. */
  readonly endpoint: string;
  readonly fps?: number;
  readonly steps?: number;
  readonly usdPerGpuSecond?: number;
  /** Conversion dollars → crédits, pour la facturation. */
  readonly creditsPerUsd?: number;
  readonly client?: ComfyUIClient;
  /** Remonte la sortie ComfyUI vers le stockage et renvoie sa clé. */
  readonly collect?: (output: { filename: string; subfolder: string }) => Promise<string>;
}

export class LTXProvider implements VideoModelProvider {
  readonly id = "ltx";
  readonly name = "LTX-2.5";
  readonly capabilities = CAPABILITIES;

  private readonly client: ComfyUIClient;

  constructor(private readonly options: LTXOptions) {
    this.client = options.client ?? new ComfyUIClient({ endpoint: options.endpoint });
  }

  async generate(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    if (!supportsRequest(this.capabilities, request)) {
      throw new GenerationError(
        "UNSUPPORTED_REQUEST",
        `Requête hors des capacités de ${this.id}.`,
      );
    }

    const debut = Date.now();
    const seed = request.seed ?? Math.floor(Math.random() * 2 ** 31);

    try {
      const sorties = await this.client.run(this.workflow(request, seed));
      const premiere = sorties[0];
      if (!premiere) {
        throw new GenerationError("INTERNAL", "ComfyUI n'a produit aucune sortie.", true);
      }

      const videoKey = this.options.collect
        ? await this.options.collect(premiere)
        : `${premiere.subfolder}/${premiere.filename}`;

      const gpuSeconds = (Date.now() - debut) / 1000;

      return {
        generationId: request.generationId,
        providerId: this.id,
        videoKey,
        durationSeconds: request.durationSeconds,
        resolution: request.resolution,
        aspectRatio: request.aspectRatio,
        seed,
        actualCost: this.cout(gpuSeconds),
        generationTimeMs: Date.now() - debut,
      };
    } catch (err) {
      if (err instanceof GenerationError) throw err;
      if (err instanceof ComfyError) {
        throw new GenerationError("INTERNAL", err.message, err.retryable);
      }
      throw new GenerationError(
        "INTERNAL",
        err instanceof Error ? err.message : String(err),
        true,
      );
    }
  }

  /**
   * Estime avant de lancer (§82).
   *
   * Hypothèse : le temps GPU croît avec la durée et le nombre de pixels. À
   * recaler sur des mesures réelles — c'est ce chiffre qui décide si un plan
   * est rentable.
   */
  async estimateCost(request: VideoGenerationRequest): Promise<GenerationCost> {
    const [l, h] = this.dimensions(request);
    const facteurPixels = (l * h) / (720 * 1280);
    const gpuSeconds = request.durationSeconds * 6 * facteurPixels;
    return this.cout(gpuSeconds);
  }

  async healthCheck(): Promise<ModelHealth> {
    try {
      const r = await fetch(`${this.options.endpoint.replace(/\/$/, "")}/system_stats`);
      return r.ok
        ? { status: "healthy", checkedAt: new Date() }
        : { status: "degraded", detail: `HTTP ${r.status}`, checkedAt: new Date() };
    } catch (err) {
      return {
        status: "unavailable",
        detail: err instanceof Error ? err.message : String(err),
        checkedAt: new Date(),
      };
    }
  }

  private cout(gpuSeconds: number): GenerationCost {
    const usd = gpuSeconds * (this.options.usdPerGpuSecond ?? 0.0002);
    return {
      gpuSeconds: Math.round(gpuSeconds * 100) / 100,
      usd: Math.round(usd * 10000) / 10000,
      credits: Math.max(1, Math.ceil(usd * (this.options.creditsPerUsd ?? 100))),
    };
  }

  private dimensions(request: VideoGenerationRequest): [number, number] {
    const parRatio = DIMENSIONS[request.resolution];
    const d = parRatio?.[request.aspectRatio];
    if (!d) {
      throw new GenerationError(
        "UNSUPPORTED_REQUEST",
        `Combinaison non supportée : ${request.resolution} / ${request.aspectRatio}.`,
      );
    }
    return d;
  }

  /** Workflow ComfyUI, au format API attendu par `/prompt`. */
  private workflow(request: VideoGenerationRequest, seed: number): unknown {
    const [largeur, hauteur] = this.dimensions(request);
    const fps = this.options.fps ?? 24;
    // LTX attend un nombre d'images congruent à 1 modulo 8.
    const images = Math.floor((request.durationSeconds * fps) / 8) * 8 + 1;

    return {
      "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "ltx-video-2.5.safetensors" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: request.prompt, clip: ["1", 1] } },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: request.negativePrompt ?? NEGATIF_PAR_DEFAUT, clip: ["1", 1] },
      },
      "4": {
        class_type: "EmptyLTXVLatentVideo",
        inputs: { width: largeur, height: hauteur, length: images, batch_size: 1 },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          seed,
          steps: this.options.steps ?? 30,
          cfg: 3,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
        },
      },
      "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
      "7": {
        class_type: "SaveAnimatedWEBP",
        inputs: { images: ["6", 0], filename_prefix: request.generationId, fps, lossless: false, quality: 90, method: "default" },
      },
    };
  }
}
