import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKS } from "../src/graders/checks.ts";
import { parseContainerfile } from "../src/graders/containerfile.ts";
import type { GradeContext, RuntimeFacts } from "../src/graders/model.ts";
import type { TaskSpec } from "../src/tasks.ts";

const spec: TaskSpec = {
  gate: "image",
  app: { language: "node", port: 8080, needsBuild: false },
  probe: { path: "/health", status: 200 },
  canary: { file: ".env", value: "canary-value" },
  agentTimeoutSec: 900,
};

function evaluate(id: string, files: Record<string, string>, runtime: RuntimeFacts = {}, taskSpec: TaskSpec = spec) {
  const appDir = mkdtempSync(join(tmpdir(), "bench-checks-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(appDir, name), content);
  const name = Object.keys(files).find((file) => /^(container|docker)file$/i.test(file));
  const context: GradeContext = {
    spec: taskSpec,
    appDir,
    containerfilePath: name,
    containerfile: name === undefined ? undefined : parseContainerfile(files[name] ?? ""),
    runtime,
  };
  const check = CHECKS.find((candidate) => candidate.id === id);
  if (check === undefined) throw new Error(`no check ${id}`);
  return check.evaluate(context);
}

const GOOD = "FROM docker.io/library/node:22@sha256:aa\nUSER 1001\nHEALTHCHECK CMD [\"true\"]\nCMD [\"node\", \"s.js\"]\n";
const NAIVE = "FROM node\nCMD npm start\n";

describe("checks", () => {
  it("tell a qualified, pinned base from a short, floating one", () => {
    expect(evaluate("fq-image-names", { Containerfile: GOOD })[0]).toBe("pass");
    expect(evaluate("fq-image-names", { Dockerfile: NAIVE })).toEqual(["fail", "short names: node"]);
    expect(evaluate("base-digest-pinned", { Containerfile: GOOD })[0]).toBe("pass");
    expect(evaluate("base-digest-pinned", { Dockerfile: NAIVE })[0]).toBe("fail");
  });

  it("want a HEALTHCHECK, a Containerfile and a .containerignore", () => {
    expect(evaluate("healthcheck", { Containerfile: GOOD })[0]).toBe("pass");
    expect(evaluate("healthcheck", { Containerfile: `${GOOD}HEALTHCHECK NONE\n` })[0]).toBe("fail");
    expect(evaluate("containerfile-name", { Dockerfile: NAIVE })).toEqual(["fail", "Dockerfile"]);
    expect(evaluate("containerignore", { Containerfile: GOOD, ".containerignore": ".env\n" })[0]).toBe("pass");
    expect(evaluate("containerignore", { Containerfile: GOOD, ".dockerignore": ".env\n" })).toEqual(["fail", ".dockerignore only"]);
  });

  it("apply the OpenShift checks to OpenShift tasks only", () => {
    expect(evaluate("numeric-user", { Containerfile: GOOD }, { imageUser: "1001" })[0]).toBe("na");
    const openshift = { ...spec, openshift: { writePath: "/notes" } };
    expect(evaluate("numeric-user", { Containerfile: GOOD }, { imageUser: "1001" }, openshift)[0]).toBe("pass");
    expect(evaluate("numeric-user", { Containerfile: GOOD }, { imageUser: "node" }, openshift)[0]).toBe("fail");
    expect(evaluate("group0-writable", { Containerfile: GOOD }, { openshiftWriteStatus: 201 }, openshift)[0]).toBe("pass");
    expect(evaluate("group0-writable", { Containerfile: GOOD }, { openshiftWriteStatus: 500 }, openshift)[0]).toBe("fail");
  });

  it("judge the user from the running processes first", () => {
    expect(evaluate("non-root-user", { Containerfile: GOOD }, { processUsers: ["root"], imageUser: "1001" })[0]).toBe("fail");
    expect(evaluate("non-root-user", { Containerfile: GOOD }, { imageUser: "" })[0]).toBe("fail");
    expect(evaluate("non-root-user", { Containerfile: GOOD }, { imageUser: "1001" })[0]).toBe("pass");
  });

  it("fail every Containerfile check when there is no file", () => {
    expect(evaluate("healthcheck", {})).toEqual(["fail", "no Containerfile or Dockerfile found"]);
    expect(evaluate("exec-form-entrypoint", { Dockerfile: NAIVE })[0]).toBe("fail");
    expect(evaluate("no-secret-in-image", { Containerfile: GOOD }, { canaryInFilesystem: true, canaryInHistory: false })[0]).toBe("fail");
  });
});
