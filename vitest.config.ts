import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages resolve to their TypeScript sources in tests, no build needed.
  resolve: { conditions: ["@podman-desktop/bench-source"] },
  ssr: { resolve: { conditions: ["@podman-desktop/bench-source"] } },
  test: {
    projects: [
      { extends: true, test: { name: "contracts", include: ["bench/contracts/test/**/*.test.ts"] } },
      { extends: true, test: { name: "report", include: ["bench/report/test/**/*.test.ts"] } },
    ],
    coverage: {
      provider: "v8",
      include: ["bench/*/src/**"],
    },
  },
});
