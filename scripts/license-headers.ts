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

/**
 * Checks that every source file starts with the project's license header, as in the other
 * Podman Desktop repositories; `--fix` adds the missing ones.
 *   node scripts/license-headers.ts [--fix]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const YEAR = new Date().getFullYear();

const LICENSE = [
  `Copyright (C) ${String(YEAR)} Red Hat, Inc.`,
  "",
  'Licensed under the Apache License, Version 2.0 (the "License");',
  "you may not use this file except in compliance with the License.",
  "You may obtain a copy of the License at",
  "",
  "http://www.apache.org/licenses/LICENSE-2.0",
  "",
  "Unless required by applicable law or agreed to in writing, software",
  'distributed under the License is distributed on an "AS IS" BASIS,',
  "WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.",
  "See the License for the specific language governing permissions and",
  "limitations under the License.",
  "",
  "SPDX-License-Identifier: Apache-2.0",
];

const BLOCK = [
  "/**********************************************************************",
  ...LICENSE.map((line) => (line === "" ? " *" : ` * ${line}`)),
  " ***********************************************************************/",
].join("\n");

const HASH = ["#", ...LICENSE.map((line) => (line === "" ? "#" : `# ${line}`)), "#"].join("\n");

/** The header style of a file, or undefined when it takes none. */
function styleOf(path: string): "block" | "hash" | undefined {
  // Generated, or what agents work on: never ours to stamp.
  if (/^bench\/server-client\/src\/|\/drizzle\/|\/schemas\/|^bench\/server\/openapi\/|^pnpm-lock\.yaml$/.test(path)) return undefined;
  if (path.startsWith("bench/tasks/") && !/\/(task|expect)\.yaml$/.test(path)) return undefined;
  if (/\.(ts|js|mjs|css)$/.test(path)) return "block";
  if (/\.(ya?ml|sh|conf)$/.test(path) || /(^|\/)Containerfile$/.test(path)) return "hash";
  return undefined;
}

/** Copyright (C) <year or range> Red Hat, Inc. somewhere in the first lines. */
const PRESENT = /Copyright \(C\) \d{4}(-\d{4})? Red Hat, Inc\.[\s\S]*SPDX-License-Identifier: Apache-2\.0/;

const fix = process.argv.includes("--fix");
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
const missing: string[] = [];
for (const path of files) {
  const style = styleOf(path);
  if (style === undefined) continue;
  const text = readFileSync(path, "utf8");
  if (PRESENT.test(text.split("\n").slice(0, 25).join("\n"))) continue;
  missing.push(path);
  if (!fix) continue;
  const header = style === "block" ? BLOCK : HASH;
  // A shebang stays first.
  const shebang = text.startsWith("#!") ? text.slice(0, text.indexOf("\n") + 1) : "";
  writeFileSync(path, `${shebang}${header}\n\n${text.slice(shebang.length)}`);
}

if (missing.length > 0) {
  console.log(`${fix ? "added the license header to" : "missing the license header"}:\n  ${missing.join("\n  ")}`);
  if (!fix) process.exitCode = 1;
}
