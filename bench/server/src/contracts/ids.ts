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

import { z } from "zod";

/** Agent Skills names, task ids and check ids: lowercase letters, digits and single hyphens. */
export const Slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const SkillName = Slug;
export const TaskId = Slug;
export const CheckId = Slug;

/** A model as the gateway names it, e.g. `enmaas/claude-sonnet` or `gpt-oss-120b`. */
export const ModelId = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

/** A full git commit or tree SHA. */
export const Sha = z.string().regex(/^[0-9a-f]{40}$/);

/** Semantic version, as in a skill's `metadata.version`. */
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

/**
 * `without`: no skill installed. `with`: only the evaluated skill. `bundle`: every skill of the
 * repository, to catch interference between skills.
 */
export const Arm = z.enum(["without", "with", "bundle"]).meta({ id: "Arm" });
export type Arm = z.infer<typeof Arm>;

export const Harness = z.enum(["claude-code", "codex", "opencode"]).meta({ id: "Harness" });
export type Harness = z.infer<typeof Harness>;
