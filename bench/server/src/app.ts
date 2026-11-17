import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardSchemaValidationPipe } from "@nestjs/common";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { ASSETS_PREFIX } from "./report/report.controller.ts";
import { DomainErrorFilter } from "./http/domain-error.filter.ts";

/** The report's bundle: bench/report/dist/assets, next to its package's src/ or dist/ entry. */
export function reportAssetsDir(): string {
  const entry = fileURLToPath(import.meta.resolve("@podman-desktop/bench-report"));
  return join(dirname(entry), "..", "dist", "assets");
}

/** Everything main.ts and the tests share. */
export function configure(app: NestNodeApplication): NestNodeApplication {
  app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));
  app.useGlobalFilters(new DomainErrorFilter());
  // A shard's trials with their evidence stay well under this.
  app.useBodyParser("json", { limit: "1mb" });
  app.useStaticAssets(reportAssetsDir(), { prefix: ASSETS_PREFIX, maxAge: "1h", dotfiles: "deny", index: false });
  return app;
}
