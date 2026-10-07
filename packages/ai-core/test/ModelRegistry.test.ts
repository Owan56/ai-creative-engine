import { describe, expect, it } from "vitest";
import { ModelRegistry } from "../src/registry/ModelRegistry.js";
import {
  FakeProvider,
  LICENCE_LIBRE,
  LICENCE_RESTREINTE,
} from "./helpers.js";

describe("ModelRegistry", () => {
  it("refuse d'enregistrer deux fois le même provider", () => {
    const registre = new ModelRegistry();
    registre.register(new FakeProvider({ id: "a" }), LICENCE_LIBRE);
    expect(() =>
      registre.register(new FakeProvider({ id: "a" }), LICENCE_LIBRE),
    ).toThrow(/déjà enregistré/);
  });

  it("n'expose aucun modèle activé par défaut", () => {
    const registre = new ModelRegistry();
    registre.register(new FakeProvider({ id: "a" }), LICENCE_LIBRE);
    // L'activation doit être un geste explicite, jamais un effet de bord.
    expect(registre.usable()).toHaveLength(0);
  });

  it("exclut un modèle sans droit commercial même s'il est activé (§116)", () => {
    const registre = new ModelRegistry();
    registre.register(
      new FakeProvider({ id: "hunyuan" }),
      LICENCE_RESTREINTE,
      { enabled: true },
    );
    expect(registre.usable()).toHaveLength(0);
  });

  it("exclut un modèle en maintenance", () => {
    const registre = new ModelRegistry();
    registre.register(new FakeProvider({ id: "a" }), LICENCE_LIBRE, {
      enabled: true,
    });
    expect(registre.usable()).toHaveLength(1);

    registre.setMaintenanceMode("a", true);
    expect(registre.usable()).toHaveLength(0);
  });

  it("refuse un multiplicateur de coût nul ou négatif", () => {
    const registre = new ModelRegistry();
    registre.register(new FakeProvider({ id: "a" }), LICENCE_LIBRE);
    expect(() => registre.setCostMultiplier("a", 0)).toThrow();
    expect(() => registre.setCostMultiplier("a", -1)).toThrow();
  });
});
