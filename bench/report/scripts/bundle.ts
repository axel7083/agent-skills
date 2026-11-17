/** Bundles the browser entry and copies the stylesheet to dist/assets, served by the bench server. */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "dist", "assets");

export async function bundle(target = outDir): Promise<void> {
  await mkdir(target, { recursive: true });
  await build({
    entryPoints: [join(root, "src", "page.ts")],
    outfile: join(target, "report.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    sourcemap: true,
    conditions: ["@podman-desktop/bench-source"],
    legalComments: "linked",
  });
  await copyFile(join(root, "src", "report.css"), join(target, "report.css"));
}

if (import.meta.main) await bundle();
