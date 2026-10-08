/**
 * Client ComfyUI (cahier des charges §21).
 *
 * ComfyUI est une couche d'inférence, jamais l'interface utilisateur. Le
 * client ne connaît pas le contenu des workflows : il les reçoit déjà
 * paramétrés et se contente de les soumettre et d'attendre.
 */

export interface ComfyOptions {
  readonly endpoint: string;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof globalThis.fetch;
}

export interface ComfyOutput {
  readonly filename: string;
  readonly subfolder: string;
  readonly type: string;
}

export class ComfyError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ComfyError";
  }
}

export class ComfyUIClient {
  constructor(private readonly options: ComfyOptions) {}

  /** Soumet un workflow et attend ses sorties. */
  async run(workflow: unknown, signal?: AbortSignal): Promise<ComfyOutput[]> {
    const fetcher = this.options.fetcher ?? globalThis.fetch;
    const base = this.options.endpoint.replace(/\/$/, "");

    const reponse = await fetcher(`${base}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal,
    });

    if (!reponse.ok) {
      throw new ComfyError(
        `ComfyUI a refusé le workflow (${reponse.status}).`,
        reponse.status >= 500,
      );
    }

    const { prompt_id } = (await reponse.json()) as { prompt_id?: string };
    if (!prompt_id) throw new ComfyError("ComfyUI n'a pas renvoyé de prompt_id.");

    return this.attendre(base, prompt_id, fetcher, signal);
  }

  private async attendre(
    base: string,
    promptId: string,
    fetcher: typeof globalThis.fetch,
    signal?: AbortSignal,
  ): Promise<ComfyOutput[]> {
    const intervalle = this.options.pollIntervalMs ?? 2000;
    const limite = Date.now() + (this.options.timeoutMs ?? 15 * 60_000);

    while (Date.now() < limite) {
      if (signal?.aborted) throw new ComfyError("Génération annulée.");

      const r = await fetcher(`${base}/history/${promptId}`, { signal });
      if (r.ok) {
        const histoire = (await r.json()) as Record<string, HistoireEntree>;
        const entree = histoire[promptId];

        if (entree?.status?.status_str === "error") {
          throw new ComfyError("Le workflow ComfyUI a échoué.", true);
        }
        if (entree?.outputs) {
          const sorties = Object.values(entree.outputs)
            .flatMap((n) => n.gifs ?? n.videos ?? n.images ?? []);
          if (sorties.length > 0) return sorties;
        }
      }
      await new Promise((r) => setTimeout(r, intervalle));
    }

    // Un dépassement est réessayable : le GPU a pu être lent, pas cassé.
    throw new ComfyError("ComfyUI n'a pas répondu dans le délai imparti.", true);
  }
}

interface HistoireEntree {
  status?: { status_str?: string };
  outputs?: Record<string, { gifs?: ComfyOutput[]; videos?: ComfyOutput[]; images?: ComfyOutput[] }>;
}
