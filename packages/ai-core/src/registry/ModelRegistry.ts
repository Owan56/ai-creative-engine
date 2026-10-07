/**
 * Registre des modèles (cahier des charges §17, §120).
 *
 * Un modèle open-weight n'est PAS automatiquement exploitable commercialement.
 * Le registre porte l'état d'activation ET l'état de licence, et les deux
 * doivent être vrais pour qu'un modèle serve en production.
 */

import type { VideoModelProvider } from "../providers/VideoModelProvider.js";

export interface ModelLicense {
  /** Nom de la licence, ex. "Apache-2.0", "Tencent Community License". */
  readonly name: string;
  readonly sourceUrl: string;
  /** Usage commercial autorisé, après vérification juridique. */
  readonly commercialAllowed: boolean;
  /** Territoires exclus, vide si aucun. */
  readonly territorialRestrictions: readonly string[];
  readonly attributionRequired: boolean;
  /** Date de la dernière vérification humaine de cette licence. */
  readonly verifiedAt: string;
  readonly notes?: string;
}

export interface ModelRegistryEntry {
  readonly provider: VideoModelProvider;
  readonly license: ModelLicense;
  /** Interrupteur d'exploitation, pilotable depuis /admin/models. */
  enabled: boolean;
  /** Priorité à score égal : plus haut gagne. */
  priority: number;
  /** Multiplicateur de coût, pour ajuster la marge sans redéployer. */
  costMultiplier: number;
  maxConcurrency: number;
  maintenanceMode: boolean;
}

export interface RegisterOptions {
  enabled?: boolean;
  priority?: number;
  costMultiplier?: number;
  maxConcurrency?: number;
  maintenanceMode?: boolean;
}

export class ModelRegistry {
  private readonly entries = new Map<string, ModelRegistryEntry>();

  register(
    provider: VideoModelProvider,
    license: ModelLicense,
    options: RegisterOptions = {},
  ): void {
    if (this.entries.has(provider.id)) {
      throw new Error(`Provider déjà enregistré : ${provider.id}`);
    }

    this.entries.set(provider.id, {
      provider,
      license,
      enabled: options.enabled ?? false,
      priority: options.priority ?? 0,
      costMultiplier: options.costMultiplier ?? 1,
      maxConcurrency: options.maxConcurrency ?? 1,
      maintenanceMode: options.maintenanceMode ?? false,
    });
  }

  get(id: string): ModelRegistryEntry | undefined {
    return this.entries.get(id);
  }

  all(): readonly ModelRegistryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Modèles réellement utilisables maintenant.
   *
   * Un modèle activé mais sans droit commercial ne sort jamais d'ici :
   * c'est la garde qui empêche Hunyuan de partir en production par accident
   * (§116).
   */
  usable(): readonly ModelRegistryEntry[] {
    return this.all().filter(
      (e) =>
        e.enabled && !e.maintenanceMode && e.license.commercialAllowed,
    );
  }

  setEnabled(id: string, enabled: boolean): void {
    this.mustGet(id).enabled = enabled;
  }

  setMaintenanceMode(id: string, maintenance: boolean): void {
    this.mustGet(id).maintenanceMode = maintenance;
  }

  setPriority(id: string, priority: number): void {
    this.mustGet(id).priority = priority;
  }

  setCostMultiplier(id: string, multiplier: number): void {
    if (multiplier <= 0) {
      throw new Error("Le multiplicateur de coût doit être strictement positif.");
    }
    this.mustGet(id).costMultiplier = multiplier;
  }

  private mustGet(id: string): ModelRegistryEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Provider inconnu : ${id}`);
    return entry;
  }
}
