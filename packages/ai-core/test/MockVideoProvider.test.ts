import { describe, expect, it } from "vitest";
import { MockVideoProvider } from "../src/providers/MockVideoProvider.js";
import { GenerationError } from "../src/types.js";
import { requete } from "./helpers.js";

describe("MockVideoProvider", () => {
  it("génère sans GPU et ne consomme aucun crédit (§40, §112)", async () => {
    const provider = new MockVideoProvider();
    const resultat = await provider.generate(requete());

    expect(resultat.providerId).toBe("mock");
    expect(resultat.videoKey).toBe("samples/mock-ad.mp4");
    expect(resultat.actualCost.credits).toBe(0);
    expect(resultat.actualCost.usd).toBe(0);
  });

  it("conserve la seed fournie, pour la reproductibilité (§103)", async () => {
    const provider = new MockVideoProvider();
    const resultat = await provider.generate(requete({ seed: 4242 }));
    expect(resultat.seed).toBe(4242);
  });

  it("refuse une durée non supportée", async () => {
    const provider = new MockVideoProvider();
    await expect(
      provider.generate(requete({ durationSeconds: 7 })),
    ).rejects.toBeInstanceOf(GenerationError);
  });

  it("peut simuler un échec, pour tester les retries (§53)", async () => {
    const provider = new MockVideoProvider({
      failureRate: 1,
      random: () => 0,
    });
    await expect(provider.generate(requete())).rejects.toMatchObject({
      retryable: true,
    });
  });
});
