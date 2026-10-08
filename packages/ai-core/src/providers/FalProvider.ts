/**
 * Provider LTX hébergé chez fal.ai.
 *
 * Même contrat que les autres moteurs : le reste de l'application ne sait pas
 * si la vidéo vient d'un GPU loué ou d'une API. C'est ce qui permettra de
 * basculer vers un GPU propre, le jour venu, sans rien réécrire (§15, §119).
 *
 * Facturation à la seconde de vidéo produite : rien à payer quand personne
 * ne génère. Le bon choix tant que le volume ne justifie pas une machine.
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
import { NEGATIF_PAR_DEFAUT } from "./LTXProvider.js";

const QUEUE = "https://queue.fal.run";

const CAPABILITIES: ModelCapabilities = {
  imageToVideo: true,
  textToVideo: true,
  nativeAudio: false,
  durations: [5, 6, 8, 10],
  resolutions: ["480p", "720p", "1080p"],
  aspectRatios: ["9:16", "1:1", "4:5", "16:9"],
  maxDurationSeconds: 10,
  qualityScore: 0.82,
  // Plus lent qu'un GPU dédié : la file d'attente du fournisseur s'ajoute.
  speedScore: 0.6,
  productConsistencyScore: 0.8,
  // Aucune VRAM à fournir : c'est tout l'intérêt.
  minimumVramGb: 0,
};

/** Tarifs au 8 octobre 2026, en dollars par seconde de vidéo produite. */
const USD_PAR_SECONDE: Readonly<Record<string, number>> = {
  "480p": 0.02,
  "720p": 0.04,
  "1080p": 0.06,
};

export interface FalOptions {
  readonly apiKey: string;
  /** Identifiant du modèle fal, ex. `fal-ai/ltx-video/image-to-video`. */
  readonly model?: string;
  readonly creditsPerUsd?: number;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof globalThis.fetch;
  /** Rapatrie la vidéo produite vers notre stockage et renvoie sa clé. */
  readonly collect?: (url: string) => Promise<string>;
}

export class FalProvider implements VideoModelProvider {
  readonly id = "fal-ltx";
  readonly name = "LTX (fal.ai)";
  readonly capabilities = CAPABILITIES;

  private readonly model: string;

  constructor(private readonly options: FalOptions) {
    if (!options.apiKey) {
      throw new GenerationError("INTERNAL", "FAL_KEY manquante.");
    }
    this.model = options.model ?? "fal-ai/ltx-video";
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

    const requestId = await this.soumettre(request, seed);
    const videoUrl = await this.attendre(requestId, request.generationId);

    const videoKey = this.options.collect
      ? await this.options.collect(videoUrl)
      : videoUrl;

    return {
      generationId: request.generationId,
      providerId: this.id,
      videoKey,
      durationSeconds: request.durationSeconds,
      resolution: request.resolution,
      aspectRatio: request.aspectRatio,
      seed,
      actualCost: await this.estimateCost(request),
      generationTimeMs: Date.now() - debut,
    };
  }

  /**
   * Le coût est connu d'avance : il ne dépend que de la durée et de la
   * définition, pas du temps de calcul. C'est un avantage réel sur un GPU
   * loué, dont la facture dépend de la vitesse réelle.
   */
  async estimateCost(request: VideoGenerationRequest): Promise<GenerationCost> {
    const parSeconde = USD_PAR_SECONDE[request.resolution];
    if (parSeconde === undefined) {
      throw new GenerationError(
        "UNSUPPORTED_REQUEST",
        `Définition non tarifée : ${request.resolution}.`,
      );
    }
    const usd = request.durationSeconds * parSeconde;
    return {
      gpuSeconds: 0,
      usd: Math.round(usd * 10000) / 10000,
      credits: Math.max(1, Math.ceil(usd * (this.options.creditsPerUsd ?? 50))),
    };
  }

  async healthCheck(): Promise<ModelHealth> {
    // fal.ai n'expose pas de sonde publique ; une clé présente et un service
    // joignable suffisent. L'indisponibilité réelle ressortira à la
    // soumission, où elle est traitée comme réessayable.
    return { status: "healthy", checkedAt: new Date() };
  }

  // ------------------------------------------------------------ interne

  private async soumettre(
    request: VideoGenerationRequest,
    seed: number,
  ): Promise<string> {
    const reponse = await this.appel(`${QUEUE}/${this.model}`, {
      method: "POST",
      body: JSON.stringify({
        prompt: request.prompt,
        negative_prompt: request.negativePrompt ?? NEGATIF_PAR_DEFAUT,
        ...(request.productImageKey ? { image_url: request.productImageKey } : {}),
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
        duration: request.durationSeconds,
        seed,
      }),
    });

    const { request_id } = (await reponse.json()) as { request_id?: string };
    if (!request_id) {
      throw new GenerationError("INTERNAL", "fal.ai n'a pas renvoyé de request_id.", true);
    }
    return request_id;
  }

  private async attendre(requestId: string, generationId: string): Promise<string> {
    const intervalle = this.options.pollIntervalMs ?? 3000;
    const limite = Date.now() + (this.options.timeoutMs ?? 10 * 60_000);
    const base = `${QUEUE}/${this.model}/requests/${requestId}`;

    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, intervalle));

      const statut = (await (await this.appel(`${base}/status`, { method: "GET" })).json()) as {
        status?: string;
      };

      if (statut.status === "COMPLETED") {
        const resultat = (await (await this.appel(base, { method: "GET" })).json()) as {
          video?: { url?: string };
        };
        const url = resultat.video?.url;
        if (!url) {
          throw new GenerationError("INTERNAL", "fal.ai n'a renvoyé aucune vidéo.", true);
        }
        return url;
      }

      if (statut.status === "FAILED" || statut.status === "ERROR") {
        throw new GenerationError(
          "INTERNAL",
          `fal.ai a échoué sur la génération ${generationId}.`,
          true,
        );
      }
    }

    throw new GenerationError("TIMEOUT", "fal.ai n'a pas répondu dans le délai.", true);
  }

  private async appel(
    url: string,
    init: { method: string; body?: string },
  ): Promise<Response> {
    const fetcher = this.options.fetcher ?? globalThis.fetch;

    let reponse: Response;
    try {
      reponse = await fetcher(url, {
        method: init.method,
        headers: {
          Authorization: `Key ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(init.body ? { body: init.body } : {}),
      });
    } catch (err) {
      throw new GenerationError(
        "PROVIDER_UNAVAILABLE",
        `fal.ai injoignable : ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    if (!reponse.ok) {
      // Une clé invalide ne se corrige pas en réessayant ; une saturation si.
      const auth = reponse.status === 401 || reponse.status === 403;
      throw new GenerationError(
        auth ? "INTERNAL" : "PROVIDER_UNAVAILABLE",
        `fal.ai a répondu ${reponse.status}.`,
        !auth && reponse.status !== 400,
      );
    }

    return reponse;
  }
}
