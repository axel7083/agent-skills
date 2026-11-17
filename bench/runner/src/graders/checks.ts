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

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CheckStatus } from "@podman-desktop/agent-skills-bench-server-client";
import { type Containerfile, externalImages, find, finalStage, flags, isExecForm } from "./containerfile.ts";
import type { Check, GradeContext } from "./model.ts";

type Result = readonly [CheckStatus, string];

const NO_FILE: Result = ["fail", "no Containerfile or Dockerfile found"];

function withContainerfile(context: GradeContext, evaluate: (containerfile: Containerfile) => Result): Result {
  if (context.containerfile === undefined || context.containerfile.stages.length === 0) return NO_FILE;
  return evaluate(context.containerfile);
}

function contextDir(context: GradeContext): string {
  return context.containerfilePath === undefined ? context.appDir : join(context.appDir, dirname(context.containerfilePath));
}

function nonEmptyFile(path: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8").trim() !== "";
}

const ROOT_USERS = new Set(["", "root", "0", "0:0", "root:root", "root:0", "0:root"]);

const openshiftOnly = (context: GradeContext): Result | undefined => (context.spec.openshift === undefined ? ["na", "not an OpenShift task"] : undefined);

/**
 * The checks of the `containerfile-best-practices` evaluation. Each returns `na` where the practice
 * doesn't apply, so a correct choice is never penalised.
 */
export const CHECKS: readonly Check[] = [
  {
    id: "fq-image-names",
    title: "Fully qualified image names",
    rule: "Name every base image with its registry (registry/namespace/name).",
    evaluate: (context: GradeContext): Result =>
      withContainerfile(context, (containerfile) => {
        const images = externalImages(containerfile);
        if (images.length === 0) return ["na", "no external base image"];
        const short = images.filter((image) => image.registry === undefined).map((image) => image.raw);
        return short.length > 0 ? ["fail", `short names: ${short.join(", ")}`] : ["pass", images.map((image) => image.raw).join(", ")];
      }),
  },
  {
    id: "base-digest-pinned",
    title: "Base image pinned by digest",
    rule: "Pin every base image by its @sha256 digest.",
    evaluate: (context: GradeContext): Result =>
      withContainerfile(context, (containerfile) => {
        const images = externalImages(containerfile);
        if (images.length === 0) return ["na", "no external base image"];
        const unpinned = images.filter((image) => image.digest === undefined).map((image) => image.raw);
        return unpinned.length > 0 ? ["fail", `not pinned by digest: ${unpinned.join(", ")}`] : ["pass", "every base image pinned by digest"];
      }),
  },
  {
    id: "healthcheck",
    title: "HEALTHCHECK",
    rule: "Declare a HEALTHCHECK in the final stage.",
    evaluate: (context: GradeContext): Result =>
      withContainerfile(context, (containerfile) => {
        const final = finalStage(containerfile);
        const declared = final === undefined ? [] : find(final, "HEALTHCHECK");
        const last = declared.at(-1);
        if (last === undefined || last.args.toUpperCase().startsWith("NONE")) return ["fail", "no HEALTHCHECK"];
        return ["pass", `HEALTHCHECK ${last.args.slice(0, 80)}`];
      }),
  },
  {
    id: "containerfile-name",
    title: "File named Containerfile",
    rule: "Name the build file Containerfile.",
    evaluate: (context: GradeContext): Result => {
      if (context.containerfilePath === undefined) return NO_FILE;
      const name = basename(context.containerfilePath);
      return [name.toLowerCase().startsWith("containerfile") ? "pass" : "fail", name];
    },
  },
  {
    id: "containerignore",
    title: ".containerignore",
    rule: "Keep the build context clean with a .containerignore.",
    evaluate: (context: GradeContext): Result => {
      if (context.containerfilePath === undefined) return NO_FILE;
      const dir = contextDir(context);
      if (nonEmptyFile(join(dir, ".containerignore"))) return ["pass", ".containerignore"];
      if (nonEmptyFile(join(dir, ".dockerignore"))) return ["fail", ".dockerignore only"];
      return ["fail", "no ignore file in the build context"];
    },
  },
  {
    id: "numeric-user",
    title: "OpenShift: numeric USER",
    rule: "Declare the runtime user as a numeric UID other than 0.",
    evaluate: (context: GradeContext): Result => {
      const skip = openshiftOnly(context);
      if (skip !== undefined) return skip;
      const user = context.runtime.imageUser;
      if (user === undefined) return ["fail", "image not built"];
      const uid = user.split(":")[0] ?? "";
      if (uid === "") return ["fail", "no USER: runs as root"];
      if (!/^\d+$/.test(uid)) return ["fail", `USER ${user} is a name: the platform can't check it isn't root`];
      if (uid === "0") return ["fail", "USER 0"];
      return ["pass", `USER ${user}`];
    },
  },
  {
    id: "group0-writable",
    title: "OpenShift: group 0 writable dirs",
    rule: "Make the directories the app writes to owned by group 0 and group-writable.",
    evaluate: (context: GradeContext): Result => {
      const skip = openshiftOnly(context);
      if (skip !== undefined) return skip;
      const status = context.runtime.openshiftWriteStatus;
      if (status === undefined) return ["fail", "the image didn't start under an arbitrary UID"];
      if (status === null) return ["fail", "the write request got no answer"];
      return [status >= 200 && status < 300 ? "pass" : "fail", `POST ${context.spec.openshift?.writePath ?? ""} as an arbitrary UID: HTTP ${String(status)}`];
    },
  },
  {
    id: "non-root-user",
    title: "Non-root user",
    rule: "Run the application as a non-root user.",
    evaluate: (context: GradeContext): Result => {
      const users = context.runtime.processUsers;
      if (users !== undefined && users.length > 0) {
        return users.some((user) => user === "root" || user === "0") ? ["fail", "a process runs as root"] : ["pass", `processes run as ${[...new Set(users)].join(", ")}`];
      }
      const user = context.runtime.imageUser;
      if (user === undefined) return ["fail", "image not built"];
      return ROOT_USERS.has(user) ? ["fail", `USER ${user === "" ? "(unset)" : user}`] : ["pass", `USER ${user}`];
    },
  },
  {
    id: "multi-stage",
    title: "Multi-stage build",
    rule: "Build in one stage, ship only the output from a clean runtime stage.",
    evaluate: (context: GradeContext): Result => {
      if (!context.spec.app.needsBuild) return ["na", "the app has no build step"];
      return withContainerfile(context, (containerfile) => {
        const final = finalStage(containerfile);
        if (final === undefined || containerfile.stages.length < 2) return ["fail", "single stage"];
        if (final.baseStage !== undefined && find(final.baseStage, "RUN").length > 0) return ["fail", "the final stage derives from the build stage"];
        if (!find(final, "COPY").some((copy) => flags(copy).has("from"))) return ["fail", "the final stage doesn't COPY --from a build stage"];
        return ["pass", `${String(containerfile.stages.length)} stages, the final one copies the build output`];
      });
    },
  },
  {
    id: "no-secret-in-image",
    title: "No secret in the image",
    rule: "Never copy secrets such as .env files into the image.",
    evaluate: (context: GradeContext): Result => {
      if (context.spec.canary === undefined) return ["na", "the task plants no secret"];
      const { canaryInFilesystem, canaryInHistory } = context.runtime;
      if (canaryInFilesystem === undefined && canaryInHistory === undefined) return ["fail", "image not built"];
      const where = [canaryInFilesystem === true && "filesystem", canaryInHistory === true && "history"].filter((place) => place !== false);
      return where.length > 0 ? ["fail", `the planted secret is in the image ${where.join(" and ")}`] : ["pass", "the planted secret isn't in the image"];
    },
  },
  {
    id: "exec-form-entrypoint",
    title: "Exec-form entrypoint",
    rule: "Use the exec (JSON) form for CMD and ENTRYPOINT, so signals reach the app.",
    evaluate: (context: GradeContext): Result =>
      withContainerfile(context, (containerfile) => {
        const final = finalStage(containerfile);
        const commands = final === undefined ? [] : [...find(final, "CMD"), ...find(final, "ENTRYPOINT")];
        if (commands.length === 0) return ["na", "CMD and ENTRYPOINT come from the base image"];
        const shell = commands.filter((command) => !isExecForm(command)).map((command) => `${command.keyword} ${command.args}`);
        return shell.length > 0 ? ["fail", `shell form: ${shell.join("; ")}`] : ["pass", "exec form"];
      }),
  },
];

export const CHECK_TITLES: Readonly<Record<string, string>> = Object.fromEntries(CHECKS.map((check) => [check.id, check.title]));
