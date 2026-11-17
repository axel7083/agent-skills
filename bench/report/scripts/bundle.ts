/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

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
    conditions: ["@podman-desktop/agent-skills-source"],
    legalComments: "linked",
  });
  await copyFile(join(root, "src", "report.css"), join(target, "report.css"));
}

if (import.meta.main) await bundle();
