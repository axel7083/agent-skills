import { join } from "node:path";

/** The repository root: bench/runner/src/ is three levels down. */
export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
export const TASKS_DIR = join(REPO_ROOT, "bench", "tasks");
export const EVALS_DIR = join(REPO_ROOT, "bench", "evals");
export const SKILLS_DIR = join(REPO_ROOT, "skills");
export const SANDBOX_LOCK = join(REPO_ROOT, "bench", "sandbox", "image.lock");
