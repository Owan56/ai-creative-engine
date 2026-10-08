import { describe, expect, it, vi } from "vitest";
import { ComfyUIClient } from "../src/providers/ComfyUIClient.js";
import { LTXProvider, NEGATIF_PAR_DEFAUT } from "../src/providers/LTXProvider.js";
import { GenerationError, type VideoGenerationRequest } from "../src/types.js";

function requete(s: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    generationId: "gen-1",
    prompt: "un collier doré sur fond studio",
    durationSeconds: 10,
    resolution: "720p",
    aspectRatio: "9:16",
    mode: "product",
    ...s,
  };
}

/** Client ComfyUI simulé : capture le workflow soumis. */
function clientSimule(sorties = [{ filename: "a.webp", subfolder: "video", type: "output" }]) {
  const vu: unknown[] = [];
  const client = {
    run: async (workflow: unknown) => {
      vu.push(workflow);
      return sorties;
    },
  } as unknown as ComfyUIClient;
  return { client, vu };
}

describe("LTXProvider", () => {
  it("produit un résultat et conserve la seed (§103)", async () => {
    const { client } = clientSimule();
    const r = await new LTXProvider({ endpoint: "http://gpu", client }).generate(
      requete({ seed: 999 }),
    );

    expect(r.providerId).toBe("ltx");
    expect(r.seed).toBe(999);
    expect(r.videoKey).toBe("video/a.webp");
  });

  it("applique les contraintes négatives par défaut (§100)", async () => {
    const { client, vu } = clientSimule();
    await new LTXProvider({ endpoint: "http://gpu", client }).generate(requete());

    const w = vu[0] as Record<string, { inputs: { text?: string } }>;
    expect(w["3"]!.inputs.text).toBe(NEGATIF_PAR_DEFAUT);
  });

  it("respecte les contraintes négatives fournies", async () => {
    const { client, vu } = clientSimule();
    await new LTXProvider({ endpoint: "http://gpu", client }).generate(
      requete({ negativePrompt: "pas de texte" }),
    );

    const w = vu[0] as Record<string, { inputs: { text?: string } }>;
    expect(w["3"]!.inputs.text).toBe("pas de texte");
  });

  it("calcule des dimensions conformes au format demandé", async () => {
    const { client, vu } = clientSimule();
    await new LTXProvider({ endpoint: "http://gpu", client }).generate(
      requete({ resolution: "1080p", aspectRatio: "16:9" }),
    );

    const w = vu[0] as Record<string, { inputs: { width?: number; height?: number } }>;
    expect(w["4"]!.inputs).toMatchObject({ width: 1920, height: 1080 });
  });

  it("produit un nombre d'images congruent à 1 modulo 8", async () => {
    const { client, vu } = clientSimule();
    await new LTXProvider({ endpoint: "http://gpu", client, fps: 24 }).generate(requete());

    const w = vu[0] as Record<string, { inputs: { length?: number } }>;
    // LTX l'exige ; une autre valeur fait échouer le workflow.
    expect((w["4"]!.inputs.length! - 1) % 8).toBe(0);
  });

  it("refuse une durée hors capacités", async () => {
    const { client } = clientSimule();
    await expect(
      new LTXProvider({ endpoint: "http://gpu", client }).generate(
        requete({ durationSeconds: 20 }),
      ),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("estime un coût croissant avec la durée et la définition", async () => {
    const p = new LTXProvider({ endpoint: "http://gpu" });
    const court = await p.estimateCost(requete({ durationSeconds: 5 }));
    const long = await p.estimateCost(requete({ durationSeconds: 10 }));
    const grand = await p.estimateCost(requete({ durationSeconds: 10, resolution: "1080p" }));

    expect(long.gpuSeconds).toBeGreaterThan(court.gpuSeconds);
    expect(grand.gpuSeconds).toBeGreaterThan(long.gpuSeconds);
    // Jamais zéro crédit : une génération gratuite viderait la marge.
    expect(court.credits).toBeGreaterThanOrEqual(1);
  });

  it("traduit une panne ComfyUI en erreur réessayable", async () => {
    const client = {
      run: async () => {
        throw new Error("GPU perdu");
      },
    } as unknown as ComfyUIClient;

    await expect(
      new LTXProvider({ endpoint: "http://gpu", client }).generate(requete()),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("signale une absence de sortie plutôt que de renvoyer un résultat vide", async () => {
    const { client } = clientSimule([]);
    await expect(
      new LTXProvider({ endpoint: "http://gpu", client }).generate(requete()),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("rapporte l'indisponibilité quand l'endpoint ne répond pas", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const sante = await new LTXProvider({ endpoint: "http://absent" }).healthCheck();
    expect(sante.status).toBe("unavailable");
    vi.unstubAllGlobals();
  });
});

describe("ComfyUIClient", () => {
  it("soumet puis attend la sortie", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ prompt_id: "p1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          p1: { outputs: { "7": { gifs: [{ filename: "o.webp", subfolder: "v", type: "output" }] } } },
        }),
      });

    const sorties = await new ComfyUIClient({
      endpoint: "http://gpu",
      pollIntervalMs: 1,
      fetcher: fetcher as unknown as typeof fetch,
    }).run({});

    expect(sorties[0]!.filename).toBe("o.webp");
  });

  it("signale un workflow en erreur comme réessayable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ prompt_id: "p1" }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ p1: { status: { status_str: "error" } } }),
      });

    await expect(
      new ComfyUIClient({
        endpoint: "http://gpu",
        pollIntervalMs: 1,
        fetcher: fetcher as unknown as typeof fetch,
      }).run({}),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("abandonne proprement au dépassement du délai", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ prompt_id: "p1" }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(
      new ComfyUIClient({
        endpoint: "http://gpu",
        pollIntervalMs: 1,
        timeoutMs: 30,
        fetcher: fetcher as unknown as typeof fetch,
      }).run({}),
    ).rejects.toMatchObject({ retryable: true });
  });
});
