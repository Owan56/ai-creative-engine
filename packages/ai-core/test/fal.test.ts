import { describe, expect, it, vi } from "vitest";
import { FalProvider } from "../src/providers/FalProvider.js";
import { GenerationError, type VideoGenerationRequest } from "../src/types.js";

function requete(s: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    generationId: "g1",
    prompt: "un collier doré",
    durationSeconds: 5,
    resolution: "1080p",
    aspectRatio: "9:16",
    mode: "product",
    ...s,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe("FalProvider", () => {
  it("exige une clé API", () => {
    expect(() => new FalProvider({ apiKey: "" })).toThrow(GenerationError);
  });

  it("tarife à la seconde de vidéo, sans temps GPU", async () => {
    const p = new FalProvider({ apiKey: "k" });
    const c = await p.estimateCost(requete({ durationSeconds: 5, resolution: "1080p" }));

    // 5 s × 0,06 $ = 0,30 $. Le coût est connu AVANT de lancer, contrairement
    // à un GPU loué dont la facture dépend de la vitesse réelle.
    expect(c.usd).toBeCloseTo(0.3, 4);
    expect(c.gpuSeconds).toBe(0);
    expect(c.credits).toBeGreaterThanOrEqual(1);
  });

  it("coûte moins cher en définition réduite", async () => {
    const p = new FalProvider({ apiKey: "k" });
    const hd = await p.estimateCost(requete({ resolution: "1080p" }));
    const sd = await p.estimateCost(requete({ resolution: "480p" }));
    expect(sd.usd).toBeLessThan(hd.usd);
  });

  it("soumet puis récupère la vidéo une fois la file terminée", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ request_id: "r1" }))
      .mockResolvedValueOnce(ok({ status: "IN_PROGRESS" }))
      .mockResolvedValueOnce(ok({ status: "COMPLETED" }))
      .mockResolvedValueOnce(ok({ video: { url: "https://fal/out.mp4" } }));

    const r = await new FalProvider({
      apiKey: "k",
      pollIntervalMs: 1,
      fetcher: fetcher as unknown as typeof fetch,
    }).generate(requete({ seed: 7 }));

    expect(r.providerId).toBe("fal-ltx");
    expect(r.videoKey).toBe("https://fal/out.mp4");
    expect(r.seed).toBe(7);
  });

  it("rapatrie la vidéo vers notre stockage quand on le lui demande", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ request_id: "r1" }))
      .mockResolvedValueOnce(ok({ status: "COMPLETED" }))
      .mockResolvedValueOnce(ok({ video: { url: "https://fal/out.mp4" } }));

    // Sans rapatriement, l'URL du fournisseur expire et le client perd sa vidéo.
    const r = await new FalProvider({
      apiKey: "k",
      pollIntervalMs: 1,
      fetcher: fetcher as unknown as typeof fetch,
      collect: async () => "u1/video/g1.mp4",
    }).generate(requete());

    expect(r.videoKey).toBe("u1/video/g1.mp4");
  });

  it("signale un échec de file comme réessayable", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ request_id: "r1" }))
      .mockResolvedValue(ok({ status: "FAILED" }));

    await expect(
      new FalProvider({
        apiKey: "k",
        pollIntervalMs: 1,
        fetcher: fetcher as unknown as typeof fetch,
      }).generate(requete()),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("ne réessaie pas sur une clé invalide", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(
      new FalProvider({
        apiKey: "mauvaise",
        fetcher: fetcher as unknown as typeof fetch,
      }).generate(requete()),
    ).rejects.toMatchObject({ retryable: false });
  });

  it("abandonne au bout du délai imparti", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ request_id: "r1" }))
      .mockResolvedValue(ok({ status: "IN_QUEUE" }));

    await expect(
      new FalProvider({
        apiKey: "k",
        pollIntervalMs: 1,
        timeoutMs: 30,
        fetcher: fetcher as unknown as typeof fetch,
      }).generate(requete()),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("ne demande aucune VRAM — c'est tout l'intérêt", () => {
    expect(new FalProvider({ apiKey: "k" }).capabilities.minimumVramGb).toBe(0);
  });
});
