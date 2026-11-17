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
 * A small Containerfile parser: stages, base images and instructions. It handles line
 * continuations, comments, the `escape` directive, heredocs and `ARG` substitution in `FROM`; it is
 * not a full BuildKit frontend. Input is agent-written: its size is bounded before parsing.
 */

export const MAX_CONTAINERFILE_BYTES = 256 * 1024;

export interface Instruction {
  /** Upper-cased, e.g. `RUN`. */
  readonly keyword: string;
  /** Raw arguments, continuations joined with a space. */
  readonly args: string;
  /** 1-based line where the instruction starts. */
  readonly line: number;
}

export interface ImageRef {
  readonly raw: string;
  readonly registry: string | undefined;
  readonly repository: string;
  readonly tag: string | undefined;
  readonly digest: string | undefined;
}

export interface Stage {
  readonly index: number;
  /** The `FROM` argument after `ARG` substitution. */
  readonly base: string;
  readonly name: string | undefined;
  readonly instructions: Instruction[];
  /** The earlier stage `FROM` refers to, if any. */
  readonly baseStage: Stage | undefined;
}

export interface Containerfile {
  readonly instructions: readonly Instruction[];
  readonly stages: readonly Stage[];
}

const HEREDOC = /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/g;
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function isExecForm(instruction: Instruction): boolean {
  try {
    const value: unknown = JSON.parse(instruction.args);
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  } catch {
    return false;
  }
}

/** Leading `--flag=value` options, e.g. `COPY --from=builder`. */
export function flags(instruction: Instruction): Map<string, string> {
  const out = new Map<string, string>();
  for (const token of instruction.args.split(/\s+/)) {
    if (!token.startsWith("--")) break;
    const [name = "", ...value] = token.slice(2).split("=");
    out.set(name, value.join("="));
  }
  return out;
}

export function positional(instruction: Instruction): string[] {
  const tokens = instruction.args.split(/\s+/).filter((token) => token !== "");
  while (tokens[0]?.startsWith("--") === true) tokens.shift();
  return tokens;
}

export function find(stage: Stage, keyword: string): Instruction[] {
  return stage.instructions.filter((instruction) => instruction.keyword === keyword);
}

export function parseImageRef(reference: string): ImageRef {
  let rest = reference;
  let digest: string | undefined;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let tag: string | undefined;
  const lastSlash = rest.lastIndexOf("/");
  const colon = rest.lastIndexOf(":");
  if (colon > lastSlash) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  const parts = rest.split("/");
  let registry: string | undefined;
  const first = parts[0] ?? "";
  if (parts.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost")) {
    registry = first;
    parts.shift();
  }
  return { raw: reference, registry, repository: parts.join("/"), tag, digest };
}

/** The external image a stage is built on; undefined for `scratch` and earlier stages. */
export function stageImage(stage: Stage): ImageRef | undefined {
  if (stage.baseStage !== undefined || stage.base === "scratch") return undefined;
  return parseImageRef(stage.base);
}

export function externalImages(containerfile: Containerfile): ImageRef[] {
  return containerfile.stages.map(stageImage).filter((image): image is ImageRef => image !== undefined);
}

export function finalStage(containerfile: Containerfile): Stage | undefined {
  return containerfile.stages.at(-1);
}

/** Joins continuations, drops comments, folds heredoc bodies into their instruction. */
function logicalLines(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  let escape = "\\";
  // Parser directives may only come before the first instruction.
  for (const raw of lines) {
    const stripped = raw.trim();
    if (!stripped.startsWith("#")) break;
    const directive = /^#\s*escape\s*=\s*(\S)/i.exec(stripped);
    if (directive?.[1] !== undefined) escape = directive[1];
  }

  const out: [number, string][] = [];
  let buffer: string[] = [];
  let start = 0;
  let heredocEnds: string[] = [];
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    if (heredocEnds.length > 0) {
      buffer.push(raw);
      if (raw.trim() === heredocEnds[0]) {
        heredocEnds.shift();
        if (heredocEnds.length === 0) {
          out.push([start, buffer.join("\n")]);
          buffer = [];
        }
      }
      return;
    }
    const stripped = raw.trim();
    if (buffer.length === 0 && (stripped === "" || stripped.startsWith("#"))) return;
    // A comment inside a continuation.
    if (buffer.length > 0 && stripped.startsWith("#")) return;
    if (buffer.length === 0) start = lineNumber;
    if (stripped.endsWith(escape)) {
      buffer.push(stripped.slice(0, -escape.length).trimEnd());
      return;
    }
    buffer.push(stripped);
    const joined = buffer.filter((part) => part !== "").join(" ");
    const keyword = joined.split(/\s+/, 1)[0]?.toUpperCase();
    const markers = keyword === "RUN" || keyword === "COPY" ? [...joined.matchAll(HEREDOC)].map((match) => match[1] ?? "") : [];
    if (markers.length > 0) {
      heredocEnds = markers;
      buffer = [joined];
      return;
    }
    out.push([start, joined]);
    buffer = [];
  });
  if (buffer.length > 0) out.push([start, buffer.join(" ")]);
  return out;
}

function substitute(value: string, variables: ReadonlyMap<string, string>): string {
  return value.replace(VARIABLE, (_match, braced: string | undefined, fallback: string | undefined, bare: string | undefined) => {
    const name = braced ?? bare ?? "";
    const set = variables.get(name);
    if (set !== undefined && set !== "") return set;
    return fallback ?? "";
  });
}

export function parseContainerfile(text: string): Containerfile {
  if (text.length > MAX_CONTAINERFILE_BYTES) throw new Error(`Containerfile larger than ${String(MAX_CONTAINERFILE_BYTES)} bytes`);
  const instructions: Instruction[] = logicalLines(text).map(([line, content]) => {
    const space = content.search(/\s/);
    const keyword = (space < 0 ? content : content.slice(0, space)).toUpperCase();
    return { keyword, args: space < 0 ? "" : content.slice(space).trim(), line };
  });

  const globalArgs = new Map<string, string>();
  const stages: Stage[] = [];
  const byName = new Map<string, Stage>();
  for (const instruction of instructions) {
    if (instruction.keyword === "ARG" && stages.length === 0) {
      for (const token of positional(instruction)) {
        const [name = "", ...value] = token.split("=");
        globalArgs.set(name, value.join("=").replace(/^["']|["']$/g, ""));
      }
      continue;
    }
    if (instruction.keyword === "FROM") {
      const tokens = positional(instruction);
      const base = tokens[0] === undefined ? "" : substitute(tokens[0], globalArgs);
      const name = tokens.length >= 3 && tokens[1]?.toUpperCase() === "AS" ? tokens[2] : undefined;
      let baseStage = byName.get(base.toLowerCase());
      if (baseStage === undefined && /^\d+$/.test(base) && Number(base) < stages.length) baseStage = stages[Number(base)];
      const stage: Stage = { index: stages.length, base, name, instructions: [], baseStage };
      stages.push(stage);
      if (name !== undefined) byName.set(name.toLowerCase(), stage);
      continue;
    }
    stages.at(-1)?.instructions.push(instruction);
  }
  return { instructions, stages };
}
