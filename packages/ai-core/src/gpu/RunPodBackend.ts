/**
 * Backend GPU RunPod (cahier des charges §37).
 *
 * Premier fournisseur réel. Il implémente la même interface que le mock :
 * basculer de l'un à l'autre est un changement de configuration, pas de code.
 *
 * Non exercé contre l'API réelle — cela demande une clé et un GPU facturé.
 * Les erreurs HTTP et le calcul de coût sont couverts par des tests à
 * transport injecté ; l'intégration réelle reste à valider en conditions.
 */

import {
  GPUError,
  type GPUBackend,
  type GPUInstance,
  type GPUState,
  type GPUStatus,
  type ProvisionRequest,
} from "./GPUBackend.js";

const API = "https://rest.runpod.io/v1";

/** Injectable, pour tester sans réseau. */
export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RunPodOptions {
  readonly apiKey: string;
  /** Types de GPU acceptés, du moins cher au plus cher. */
  readonly gpuTypeIds?: readonly string[];
  readonly imageName?: string;
  readonly usdPerHour?: number;
  readonly fetcher?: Fetcher;
  readonly now?: () => number;
}

interface PodReponse {
  id?: string;
  desiredStatus?: string;
  runtime?: { uptimeInSeconds?: number } | null;
  costPerHr?: number;
  ports?: unknown;
}

export class RunPodBackend implements GPUBackend {
  readonly id = "runpod";
  private readonly demarrages = new Map<string, number>();

  constructor(private readonly options: RunPodOptions) {
    if (!options.apiKey) {
      throw new GPUError("AUTH", "RUNPOD_API_KEY manquante.");
    }
  }

  async provision(request: ProvisionRequest): Promise<GPUInstance> {
    const pod = (await this.appel("/pods", "POST", {
      name: `ace-${Date.now()}`,
      imageName: this.options.imageName ?? "runpod/pytorch:latest",
      gpuTypeIds: this.options.gpuTypeIds ?? ["NVIDIA GeForce RTX 4090"],
      gpuCount: 1,
      // RunPod raisonne en Go de VRAM par GPU ; on transmet la contrainte
      // plutôt que de choisir un type en dur.
      minVCPUPerGPU: 4,
      minRAMPerGPU: Math.max(16, request.minimumVramGb),
      containerDiskInGb: 40,
      ports: ["8188/http"],
    })) as PodReponse;

    if (!pod.id) {
      throw new GPUError("INTERNAL", "RunPod n'a pas renvoyé d'identifiant.");
    }

    const maintenant = (this.options.now ?? Date.now)();
    this.demarrages.set(pod.id, maintenant);

    return {
      id: pod.id,
      state: "STARTING",
      startedAt: new Date(maintenant),
    };
  }

  /**
   * Arrête l'instance.
   *
   * Ne lève jamais : un arrêt qui échoue silencieusement laisserait un GPU
   * allumé et facturé, donc l'erreur est journalisée mais l'appelant ne doit
   * pas être bloqué dans son chemin de nettoyage.
   */
  async stop(instanceId: string): Promise<void> {
    try {
      await this.appel(`/pods/${instanceId}`, "DELETE");
    } catch (err) {
      console.error(
        `[runpod] échec de l'arrêt de ${instanceId} — vérifier la console, ` +
          `un GPU peut rester facturé :`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    } finally {
      this.demarrages.delete(instanceId);
    }
  }

  async getStatus(instanceId: string): Promise<GPUStatus> {
    const pod = (await this.appel(`/pods/${instanceId}`, "GET")) as PodReponse;
    const uptime = pod.runtime?.uptimeInSeconds;

    return {
      id: instanceId,
      state: traduireEtat(pod.desiredStatus, uptime),
      billedSeconds: uptime ?? this.ecoule(instanceId),
      ...(pod.ports ? { endpoint: String((pod.ports as string[])[0] ?? "") } : {}),
    };
  }

  async getCost(instanceId: string): Promise<number> {
    const pod = (await this.appel(`/pods/${instanceId}`, "GET")) as PodReponse;
    const secondes = pod.runtime?.uptimeInSeconds ?? this.ecoule(instanceId);
    const parHeure = pod.costPerHr ?? this.options.usdPerHour ?? 0;
    return (secondes / 3600) * parHeure;
  }

  /** Repli quand RunPod ne renvoie pas d'uptime : on compte depuis chez nous. */
  private ecoule(instanceId: string): number {
    const debut = this.demarrages.get(instanceId);
    if (!debut) return 0;
    return ((this.options.now ?? Date.now)() - debut) / 1000;
  }

  private async appel(
    chemin: string,
    method: string,
    corps?: unknown,
  ): Promise<unknown> {
    const fetcher = this.options.fetcher ?? (globalThis.fetch as unknown as Fetcher);

    let reponse: Awaited<ReturnType<Fetcher>>;
    try {
      reponse = await fetcher(`${API}${chemin}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
      });
    } catch (err) {
      throw new GPUError(
        "UNAVAILABLE",
        `RunPod injoignable : ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    if (!reponse.ok) {
      // 401/403 ne se réessaient pas : la clé est fausse, réessayer ne la
      // corrigera pas. 429 et 5xx, si.
      const codes: Record<number, ["AUTH" | "QUOTA" | "UNAVAILABLE", boolean]> = {
        401: ["AUTH", false],
        403: ["AUTH", false],
        429: ["QUOTA", true],
      };
      const [code, retryable] = codes[reponse.status] ?? [
        "UNAVAILABLE",
        reponse.status >= 500,
      ];
      throw new GPUError(code, `RunPod a répondu ${reponse.status}.`, retryable);
    }

    return reponse.json();
  }
}

function traduireEtat(statut: string | undefined, uptime: number | undefined): GPUState {
  switch (statut) {
    case "RUNNING":
      // RunPod dit RUNNING dès la création ; sans uptime, le conteneur
      // n'a pas encore démarré.
      return uptime && uptime > 0 ? "IDLE" : "STARTING";
    case "EXITED":
    case "TERMINATED":
      return "OFF";
    default:
      return "STARTING";
  }
}
