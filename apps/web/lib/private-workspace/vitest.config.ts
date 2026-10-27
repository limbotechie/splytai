import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: ["lib/private-workspace/*.test.ts"],
    testTimeout: 20_000,
  },
});
