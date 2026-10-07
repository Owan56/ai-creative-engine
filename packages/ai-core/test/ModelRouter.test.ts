import { describe, expect, it } from "vitest";
import { ModelRegistry } from "../src/registry/ModelRegistry.js";
import { ModelRouter } from "../src/router/ModelRouter.js";
import { GenerationError } from "../src/types.js";
import {
  FakeProvider,
  LICENCE_LIBRE,
  LICENCE_RESTREINTE,
  requete,
} from "./helpers.js";

function registreAvec(
  ...providers: Array<{ provider: FakeProvider; priority?: number }>
) {
  const registre = new ModelRegistry();
  for (const { provider, priority } of providers) {
    registre.register(provider, LICENCE_LIBRE, { enabled: true, priority });
  }
  return registre;
}

describe("ModelRouter", () => {
  it("ne dépasse jamais le budget en crédits (§82)", async () => {
    const registre = registreAvec({
      provider: new FakeProvider({ id: "cher", credits: 30 }),
    });

    await expect(
      new ModelRouter(registre).route(requete(), { maxCredits: 15 }),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("écarte le modèle hors budget mais garde celui qui rentre (§121)", async () => {
    const registre = registreAvec(
      { provider: new FakeProvider({ id: "ltx", credits: 12 }) },
      { provider: new FakeProvider({ id: "wan", credits: 14 }) },
      { provider: new FakeProvider({ id: "hunyuan", credits: 22 }) },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 15,
    });

    expect(decision.candidates.map((c) => c.entry.provider.id).sort()).toEqual([
      "ltx",
      "wan",
    ]);
    expect(
      decision.rejected.find((r) => r.providerId === "hunyuan")?.reason,
    ).toBe("over_budget");
  });

  it("bascule sur un autre moteur quand le premier est indisponible (§81)", async () => {
    const registre = registreAvec(
      {
        provider: new FakeProvider({
          id: "ltx",
          health: "unavailable",
          capabilities: { qualityScore: 1 },
        }),
      },
      { provider: new FakeProvider({ id: "wan" }) },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 50,
    });

    expect(decision.chosen.entry.provider.id).toBe("wan");
    expect(decision.rejected.find((r) => r.providerId === "ltx")?.reason).toBe(
      "unhealthy",
    );
  });

  it("exclut les providers déjà essayés, pour un retry (§53)", async () => {
    const registre = registreAvec(
      { provider: new FakeProvider({ id: "ltx", capabilities: { qualityScore: 1 } }) },
      { provider: new FakeProvider({ id: "wan" }) },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 50,
      excludeProviderIds: ["ltx"],
    });

    expect(decision.chosen.entry.provider.id).toBe("wan");
  });

  it("ne sélectionne jamais un modèle sans droit commercial (§17, §116)", async () => {
    const registre = new ModelRegistry();
    registre.register(
      new FakeProvider({ id: "hunyuan", capabilities: { qualityScore: 1 } }),
      LICENCE_RESTREINTE,
      { enabled: true },
    );
    registre.register(
      new FakeProvider({ id: "wan", capabilities: { qualityScore: 0.1 } }),
      LICENCE_LIBRE,
      { enabled: true },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 50,
    });

    // Hunyuan est meilleur sur la qualité, mais il ne doit même pas
    // apparaître parmi les candidats.
    expect(decision.chosen.entry.provider.id).toBe("wan");
    expect(decision.candidates).toHaveLength(1);
  });

  it("en mode product, privilégie la fidélité produit sur la qualité (§122)", async () => {
    const registre = registreAvec(
      {
        provider: new FakeProvider({
          id: "joli",
          capabilities: { qualityScore: 1, productConsistencyScore: 0.2 },
        }),
      },
      {
        provider: new FakeProvider({
          id: "fidele",
          capabilities: { qualityScore: 0.5, productConsistencyScore: 0.95 },
        }),
      },
    );

    const router = new ModelRouter(registre);

    const enModeProduit = await router.route(requete({ mode: "product" }), {
      maxCredits: 50,
    });
    expect(enModeProduit.chosen.entry.provider.id).toBe("fidele");

    // Le même parc de modèles, en mode premium, doit choisir l'autre.
    const enModePremium = await router.route(requete({ mode: "premium" }), {
      maxCredits: 50,
    });
    expect(enModePremium.chosen.entry.provider.id).toBe("joli");
  });

  it("écarte un moteur qui ne supporte pas la durée demandée (§12)", async () => {
    const registre = registreAvec({
      provider: new FakeProvider({ id: "court", capabilities: { durations: [5] } }),
    });

    await expect(
      new ModelRouter(registre).route(requete({ durationSeconds: 10 }), {
        maxCredits: 50,
      }),
    ).rejects.toThrow(/Aucun moteur disponible/);
  });

  it("applique le multiplicateur de coût de l'administration (§36)", async () => {
    const registre = new ModelRegistry();
    registre.register(
      new FakeProvider({ id: "ltx", credits: 10 }),
      LICENCE_LIBRE,
      { enabled: true, costMultiplier: 2 },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 50,
    });

    expect(decision.chosen.cost.credits).toBe(20);
  });

  it("écarte un provider dont l'estimation de coût échoue", async () => {
    const registre = registreAvec(
      { provider: new FakeProvider({ id: "casse", costThrows: true }) },
      { provider: new FakeProvider({ id: "ok" }) },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 50,
    });

    expect(decision.chosen.entry.provider.id).toBe("ok");
    expect(decision.rejected.find((r) => r.providerId === "casse")?.reason).toBe(
      "cost_estimation_failed",
    );
  });

  it("départage deux moteurs équivalents par la priorité admin", async () => {
    const registre = registreAvec(
      { provider: new FakeProvider({ id: "a" }), priority: 1 },
      { provider: new FakeProvider({ id: "b" }), priority: 5 },
    );

    const decision = await new ModelRouter(registre).route(requete(), {
      maxCredits: 50,
    });

    expect(decision.chosen.entry.provider.id).toBe("b");
  });
});
