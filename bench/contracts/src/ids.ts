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
export const Arm = z.enum(["without", "with", "bundle"]);
export type Arm = z.infer<typeof Arm>;

export const Harness = z.enum(["claude-code", "codex", "opencode"]);
export type Harness = z.infer<typeof Harness>;
