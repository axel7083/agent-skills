import type { CheckResult, CheckStatus, FailureClass } from "@podman-desktop/bench-contracts";
import type { TaskSpec } from "../tasks.ts";
import type { Containerfile } from "./containerfile.ts";

/** What the grader learned from running the image; undefined where it couldn't find out. */
export interface RuntimeFacts {
  imageUser?: string;
  imageSizeBytes?: number;
  exposedPorts?: number[];
  /** In-container users of the running processes (names or uids). */
  processUsers?: string[];
  canaryInHistory?: boolean;
  canaryInFilesystem?: boolean;
  /** HTTP status of the OpenShift write request, made under an arbitrary UID. */
  openshiftWriteStatus?: number | null;
}

/** Everything a check may look at. */
export interface GradeContext {
  readonly spec: TaskSpec;
  readonly appDir: string;
  /** The build file the grader found, relative to `appDir`. */
  readonly containerfilePath: string | undefined;
  readonly containerfile: Containerfile | undefined;
  readonly runtime: RuntimeFacts;
}

export interface Check {
  readonly id: string;
  readonly title: string;
  /** The practice, in one sentence. */
  readonly rule: string;
  evaluate(context: GradeContext): readonly [CheckStatus, string];
}

export interface Grade {
  readonly works: boolean;
  readonly failureClass: FailureClass;
  readonly checks: Record<string, CheckResult>;
  /** What the grader ran, for debugging (never published). */
  readonly log: readonly string[];
}
