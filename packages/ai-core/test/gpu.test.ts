import { describe, expect, it } from "vitest";
import { GPUError, MockGPUBackend } from "../src/gpu/GPUBackend.js";
import { RunPodBackend, type Fetcher } from "../src/gpu/RunPodBackend.js";

function faussefetch(
  reponses: Array<{ ok: boolean; status: number; body?: unknown }>,
): { fetcher: Fetcher; appels: Array<{ url: string; method: string }> } {
  const appels: Array<{ url: string; method: string }> = [];
  let i = 0;
  return {
    appels,
    fetcher: async (url, init) => {
      appels.push({ url, method: init.method });
      const r = reponses[Math.min(i++, reponses.length - 1)]!;
      return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
    },
  };
}

describe("MockGPUBackend", () => {
  it("provisionne et arrête sans machine réelle", async () => {
    const gpu = new MockGPUBackend();
    const inst = await gpu.provision({ minimumVramGb: 24 });

    expect(inst.id).toMatch(/^mock-/);
    expect((await gpu.getStatus(inst.id)).state).toBe("IDLE");

    await gpu.stop(inst.id);
    expect((await gpu.getStatus(inst.id)).state).toBe("OFF");
  });

  it("facture le temps écoulé", async () => {
    let t = 1_000_000;
    const gpu = new MockGPUBackend({ usdPerSecond: 0.0002, now: () => t });
    const inst = await gpu.provision({ minimumVramGb: 24 });

    t += 60_000; // une minute
    expect(await gpu.getCost(inst.id)).toBeCloseTo(60 * 0.0002, 6);
  });

  it("signale une instance inconnue", async () => {
    await expect(new MockGPUBackend().getStatus("inexistante")).rejects.toBeInstanceOf(
      GPUError,
    );
  });
});

describe("RunPodBackend", () => {
  it("exige une clé API", () => {
    expect(() => new RunPodBackend({ apiKey: "" })).toThrow(GPUError);
  });

  it("provisionne et renvoie STARTING", async () => {
    const { fetcher, appels } = faussefetch([{ ok: true, status: 201, body: { id: "pod-1" } }]);
    const inst = await new RunPodBackend({ apiKey: "k", fetcher }).provision({
      minimumVramGb: 24,
    });

    expect(inst.id).toBe("pod-1");
    // Le conteneur n'a pas encore démarré : surtout pas IDLE, un worker
    // l'enverrait travailler trop tôt.
    expect(inst.state).toBe("STARTING");
    expect(appels[0]).toMatchObject({ method: "POST" });
  });

  it("ne réessaie pas sur une clé invalide, mais réessaie sur un quota", async () => {
    const auth = faussefetch([{ ok: false, status: 401 }]);
    await expect(
      new RunPodBackend({ apiKey: "k", fetcher: auth.fetcher }).provision({ minimumVramGb: 24 }),
    ).rejects.toMatchObject({ code: "AUTH", retryable: false });

    const quota = faussefetch([{ ok: false, status: 429 }]);
    await expect(
      new RunPodBackend({ apiKey: "k", fetcher: quota.fetcher }).provision({ minimumVramGb: 24 }),
    ).rejects.toMatchObject({ code: "QUOTA", retryable: true });
  });

  it("traduit RUNNING sans uptime en STARTING", async () => {
    const { fetcher } = faussefetch([
      { ok: true, status: 200, body: { id: "p", desiredStatus: "RUNNING", runtime: null } },
    ]);
    const statut = await new RunPodBackend({ apiKey: "k", fetcher }).getStatus("p");
    expect(statut.state).toBe("STARTING");
  });

  it("traduit RUNNING avec uptime en IDLE", async () => {
    const { fetcher } = faussefetch([
      {
        ok: true,
        status: 200,
        body: { id: "p", desiredStatus: "RUNNING", runtime: { uptimeInSeconds: 42 } },
      },
    ]);
    const statut = await new RunPodBackend({ apiKey: "k", fetcher }).getStatus("p");
    expect(statut.state).toBe("IDLE");
    expect(statut.billedSeconds).toBe(42);
  });

  it("calcule le coût à partir de l'uptime et du tarif renvoyés", async () => {
    const { fetcher } = faussefetch([
      {
        ok: true,
        status: 200,
        body: { id: "p", desiredStatus: "RUNNING", runtime: { uptimeInSeconds: 3600 }, costPerHr: 0.44 },
      },
    ]);
    expect(await new RunPodBackend({ apiKey: "k", fetcher }).getCost("p")).toBeCloseTo(0.44, 4);
  });

  it("remonte l'échec d'un arrêt plutôt que de le taire", async () => {
    // Un arrêt silencieusement raté laisse un GPU allumé et facturé.
    const { fetcher } = faussefetch([{ ok: false, status: 500 }]);
    await expect(
      new RunPodBackend({ apiKey: "k", fetcher }).stop("p"),
    ).rejects.toBeInstanceOf(GPUError);
  });
});

describe("bootstrap du registre", () => {
  it("n'expose que le mock en développement", async () => {
    const { buildRegistry } = await import("../src/registry/bootstrap.js");
    const r = buildRegistry({ videoProvider: "mock" });
    expect(r.usable().map((e) => e.provider.id)).toEqual(["mock"]);
  });

  it("n'expose pas LTX tant que sa licence n'est pas confirmée", async () => {
    const { buildRegistry } = await import("../src/registry/bootstrap.js");
    const r = buildRegistry({
      videoProvider: "router",
      ltxEnabled: true,
      ltxEndpoint: "http://gpu",
      ltxCommercialVerified: false,
    });
    // Activé mais licence non vérifiée : jamais sélectionnable.
    expect(r.get("ltx")?.enabled).toBe(true);
    expect(r.usable()).toHaveLength(0);
  });

  it("expose LTX une fois la licence confirmée", async () => {
    const { buildRegistry } = await import("../src/registry/bootstrap.js");
    const r = buildRegistry({
      videoProvider: "router",
      ltxEnabled: true,
      ltxEndpoint: "http://gpu",
      ltxCommercialVerified: true,
    });
    expect(r.usable().map((e) => e.provider.id)).toEqual(["ltx"]);
  });
});
