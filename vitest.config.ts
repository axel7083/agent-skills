import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // SWC emits decorator metadata, which Nest's dependency injection reads at runtime.
  plugins: [swc.vite({ jsc: { target: "es2023" }, module: { type: "es6" } })],
  // Workspace packages resolve to their TypeScript sources in tests, no build needed.
  resolve: { conditions: ["@podman-desktop/bench-source"] },
  ssr: { resolve: { conditions: ["@podman-desktop/bench-source"] } },
  test: {
    projects: [
      { extends: true, test: { name: "contracts", include: ["bench/contracts/test/**/*.test.ts"] } },
      { extends: true, test: { name: "report", include: ["bench/report/test/**/*.test.ts"] } },
      { extends: true, test: { name: "runner", include: ["bench/runner/test/**/*.test.ts"] } },
      { extends: true, test: { name: "server", include: ["bench/server/test/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "server-integration",
          include: ["bench/server/test/integration/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["bench/*/src/**"],
    },
  },
});
