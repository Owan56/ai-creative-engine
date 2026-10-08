/**
 * Abstraction du fournisseur GPU (cahier des charges §37).
 *
 * Aucun code hors de ce dossier ne doit nommer RunPod. Changer de
 * fournisseur = un fichier de plus, rien d'autre.
 */

export type GPUState = "STARTING" | "IDLE" | "BUSY" | "DRAINING" | "OFF";

export interface GPUInstance {
  readonly id: string;
  readonly state: GPUState;
  readonly endpoint?: string;
  readonly startedAt: Date;
}

export interface GPUStatus {
  readonly id: string;
  readonly state: GPUState;
  readonly endpoint?: string;
  /** Secondes facturées depuis le démarrage. */
  readonly billedSeconds: number;
}

export interface ProvisionRequest {
  /** VRAM minimale requise par le modèle, en Go. */
  readonly minimumVramGb: number;
  /** Plafond de dépense pour cette instance, en dollars. */
  readonly maxCostUsd?: number;
  readonly idleTimeoutSeconds?: number;
}

export interface GPUBackend {
  readonly id: string;
  provision(request: ProvisionRequest): Promise<GPUInstance>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<GPUStatus>;
  /** Coût accumulé en dollars. */
  getCost(instanceId: string): Promise<number>;
}

export class GPUError extends Error {
  constructor(
    readonly code: "UNAVAILABLE" | "QUOTA" | "TIMEOUT" | "AUTH" | "INTERNAL",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "GPUError";
  }
}

/**
 * Backend factice : aucune machine réelle, facturation simulée.
 * Permet de développer et tester l'auto-scaling sans dépenser un euro (§40).
 */
export class MockGPUBackend implements GPUBackend {
  readonly id = "mock";
  private readonly instances = new Map<string, { startedAt: number; state: GPUState }>();

  constructor(
    private readonly options: {
      /** Démarrage à froid simulé (§38 : 1 à 3 min en réalité). */
      startupMs?: number;
      usdPerSecond?: number;
      now?: () => number;
    } = {},
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  async provision(_request: ProvisionRequest): Promise<GPUInstance> {
    const id = `mock-${Math.random().toString(36).slice(2, 10)}`;
    this.instances.set(id, { startedAt: this.now, state: "IDLE" });
    if (this.options.startupMs) {
      await new Promise((r) => setTimeout(r, this.options.startupMs));
    }
    return {
      id,
      state: "IDLE",
      endpoint: `http://mock-gpu/${id}`,
      startedAt: new Date(this.now),
    };
  }

  async stop(instanceId: string): Promise<void> {
    const inst = this.instances.get(instanceId);
    if (inst) inst.state = "OFF";
  }

  async getStatus(instanceId: string): Promise<GPUStatus> {
    const inst = this.instances.get(instanceId);
    if (!inst) throw new GPUError("UNAVAILABLE", `Instance inconnue : ${instanceId}`);
    return {
      id: instanceId,
      state: inst.state,
      billedSeconds: Math.max(0, (this.now - inst.startedAt) / 1000),
      ...(inst.state !== "OFF" ? { endpoint: `http://mock-gpu/${instanceId}` } : {}),
    };
  }

  async getCost(instanceId: string): Promise<number> {
    const { billedSeconds } = await this.getStatus(instanceId);
    return billedSeconds * (this.options.usdPerSecond ?? 0);
  }
}
