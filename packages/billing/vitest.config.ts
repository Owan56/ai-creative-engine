import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/setup.ts"],
    // Les transactions concurrentes se disputent de vrais verrous : laisser
    // de la marge, mais pas au point de masquer un interblocage.
    testTimeout: 15_000,
  },
});
