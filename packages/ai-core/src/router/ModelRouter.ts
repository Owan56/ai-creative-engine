/**
 * Routeur de modèles (cahier des charges §18, §20, §81, §82, §121, §122).
 *
 * Choisit le meilleur moteur pour une requête, selon capacités, licence,
 * santé, coût et poids de scoring configurables. Le reste de l'application
 * ne connaît aucun nom de modèle.
 */

import {
  GenerationError,
  type GenerationCost,
  type GenerationMode,
  type VideoGenerationRequest,
} from "../types.js";
import { supportsRequest } from "../providers/VideoModelProvider.js";
import type {
  ModelRegistry,
  ModelRegistryEntry,
} from "../registry/ModelRegistry.js";

/** Poids de scoring, somme libre — ils sont normalisés au calcul. */
export interface ScoringWeights {
  readonly quality: number;
  readonly speed: number;
  readonly cost: number;
  readonly productConsistency: number;
}

/**
 * Poids par mode utilisateur (§19).
 *
 * Le mode `product` applique la pondération orientée e-commerce de §122 :
 * la fidélité au produit prime sur tout le reste.
 */
export const WEIGHTS_BY_MODE: Readonly<Record<GenerationMode, ScoringWeights>> = {
  fast: { quality: 0.15, speed: 0.5, cost: 0.3, productConsistency: 0.05 },
  quality: { quality: 0.6, speed: 0.1, cost: 0.1, productConsistency: 0.2 },
  cinematic: { quality: 0.5, speed: 0.1, cost: 0.1, productConsistency: 0.3 },
  product: { quality: 0.25, speed: 0.05, cost: 0.05, productConsistency: 0.65 },
  premium: { quality: 0.7, speed: 0.05, cost: 0.05, productConsistency: 0.2 },
};

export interface RoutingConstraints {
  /** Plafond en crédits. Aucun job GPU ne part au-delà (§82). */
  readonly maxCredits: number;
  /** Restreint le choix à ces providers, si fourni. */
  readonly allowedProviderIds?: readonly string[];
  /** Providers déjà essayés et échoués, à exclure du failover (§81). */
  readonly excludeProviderIds?: readonly string[];
  /** Surcharge les poids du mode. */
  readonly weights?: ScoringWeights;
}

export interface ScoredCandidate {
  readonly entry: ModelRegistryEntry;
  readonly cost: GenerationCost;
  readonly score: number;
}

export interface RoutingDecision {
  readonly chosen: ScoredCandidate;
  /** Tous les candidats retenus, triés du meilleur au moins bon. */
  readonly candidates: readonly ScoredCandidate[];
  /** Pourquoi les autres ont été écartés — précieux en support. */
  readonly rejected: readonly RejectedCandidate[];
}

export interface RejectedCandidate {
  readonly providerId: string;
  readonly reason:
    | "excluded"
    | "not_allowed"
    | "unsupported_request"
    | "unhealthy"
    | "over_budget"
    | "cost_estimation_failed";
  readonly detail?: string;
}

export class ModelRouter {
  constructor(private readonly registry: ModelRegistry) {}

  /**
   * Sélectionne un provider. Lève une GenerationError si aucun ne convient —
   * l'appelant décide alors d'attendre un GPU ou d'abandonner le job.
   */
  async route(
    request: VideoGenerationRequest,
    constraints: RoutingConstraints,
  ): Promise<RoutingDecision> {
    const weights =
      constraints.weights ?? WEIGHTS_BY_MODE[request.mode] ?? WEIGHTS_BY_MODE.quality;

    const exclus = new Set(constraints.excludeProviderIds ?? []);
    const autorises = constraints.allowedProviderIds
      ? new Set(constraints.allowedProviderIds)
      : null;

    const rejected: RejectedCandidate[] = [];
    const retenus: Array<{ entry: ModelRegistryEntry; cost: GenerationCost }> = [];

    // `usable()` écarte déjà les modèles désactivés, en maintenance, ou sans
    // droit commercial vérifié.
    for (const entry of this.registry.usable()) {
      const id = entry.provider.id;

      if (exclus.has(id)) {
        rejected.push({ providerId: id, reason: "excluded" });
        continue;
      }
      if (autorises && !autorises.has(id)) {
        rejected.push({ providerId: id, reason: "not_allowed" });
        continue;
      }
      if (!supportsRequest(entry.provider.capabilities, request)) {
        rejected.push({ providerId: id, reason: "unsupported_request" });
        continue;
      }

      const sante = await entry.provider.healthCheck().catch(() => null);
      if (!sante || sante.status === "unavailable") {
        rejected.push({
          providerId: id,
          reason: "unhealthy",
          detail: sante?.detail,
        });
        continue;
      }

      let cost: GenerationCost;
      try {
        const brut = await entry.provider.estimateCost(request);
        cost = {
          ...brut,
          usd: brut.usd * entry.costMultiplier,
          credits: Math.ceil(brut.credits * entry.costMultiplier),
        };
      } catch (err) {
        rejected.push({
          providerId: id,
          reason: "cost_estimation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      if (cost.credits > constraints.maxCredits) {
        rejected.push({
          providerId: id,
          reason: "over_budget",
          detail: `${cost.credits} crédits > ${constraints.maxCredits}`,
        });
        continue;
      }

      retenus.push({ entry, cost });
    }

    if (retenus.length === 0) {
      throw new GenerationError(
        "PROVIDER_UNAVAILABLE",
        "Aucun moteur disponible pour cette requête.",
        true,
      );
    }

    // Le coût est normalisé contre le budget, pas contre le coût des autres
    // candidats : un modèle reste bon marché dans l'absolu même s'il est seul.
    const candidates = retenus
      .map(({ entry, cost }) => ({
        entry,
        cost,
        score: scoreCandidate(entry, cost, constraints.maxCredits, weights),
      }))
      .sort(
        (a, b) =>
          b.score - a.score || b.entry.priority - a.entry.priority,
      );

    return { chosen: candidates[0]!, candidates, rejected };
  }
}

function scoreCandidate(
  entry: ModelRegistryEntry,
  cost: GenerationCost,
  maxCredits: number,
  weights: ScoringWeights,
): number {
  const c = entry.provider.capabilities;

  // Moins cher = meilleur. Un budget nul ne doit pas produire de division
  // par zéro : le coût est alors neutre.
  const costScore =
    maxCredits > 0 ? Math.max(0, 1 - cost.credits / maxCredits) : 1;

  const total =
    weights.quality +
    weights.speed +
    weights.cost +
    weights.productConsistency;

  if (total <= 0) return 0;

  const brut =
    clamp01(c.qualityScore) * weights.quality +
    clamp01(c.speedScore) * weights.speed +
    costScore * weights.cost +
    clamp01(c.productConsistencyScore) * weights.productConsistency;

  return brut / total;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
