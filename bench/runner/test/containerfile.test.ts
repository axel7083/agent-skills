import { describe, expect, it } from "vitest";
import { externalImages, finalStage, isExecForm, parseContainerfile, parseImageRef } from "../src/graders/containerfile.ts";

describe("parseImageRef", () => {
  it.each([
    ["node", { registry: undefined, repository: "node", tag: undefined, digest: undefined }],
    ["node:22-slim", { registry: undefined, repository: "node", tag: "22-slim", digest: undefined }],
    ["docker.io/library/node:22@sha256:abc", { registry: "docker.io", repository: "library/node", tag: "22", digest: "sha256:abc" }],
    ["localhost:5000/app", { registry: "localhost:5000", repository: "app", tag: undefined, digest: undefined }],
    ["registry.access.redhat.com/ubi10/ubi-minimal", { registry: "registry.access.redhat.com", repository: "ubi10/ubi-minimal", tag: undefined, digest: undefined }],
  ])("%s", (reference, expected) => {
    expect(parseImageRef(reference)).toMatchObject(expected);
  });
});

describe("parseContainerfile", () => {
  it("follows stages, continuations, comments and ARG substitution", () => {
    const containerfile = parseContainerfile(`# syntax=docker/dockerfile:1
ARG BASE=docker.io/library/golang:1.25
FROM \${BASE} AS build
RUN go build \\
    # a comment inside a continuation
    -o /out/app .
FROM build AS test
FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/app /app
CMD ["/app"]
`);
    expect(containerfile.stages.map((stage) => stage.base)).toEqual(["docker.io/library/golang:1.25", "build", "gcr.io/distroless/static:nonroot"]);
    expect(containerfile.stages[1]?.baseStage?.name).toBe("build");
    expect(externalImages(containerfile).map((image) => image.raw)).toEqual(["docker.io/library/golang:1.25", "gcr.io/distroless/static:nonroot"]);
    expect(containerfile.stages[0]?.instructions[0]?.args).toBe("go build -o /out/app .");
    const cmd = finalStage(containerfile)?.instructions.find((instruction) => instruction.keyword === "CMD");
    expect(cmd !== undefined && isExecForm(cmd)).toBe(true);
  });

  it("folds heredocs into their instruction", () => {
    const containerfile = parseContainerfile(`FROM docker.io/library/alpine:3
RUN <<EOT
echo FROM nothing
EOT
CMD echo done
`);
    expect(containerfile.stages).toHaveLength(1);
    expect(containerfile.instructions.map((instruction) => instruction.keyword)).toEqual(["FROM", "RUN", "CMD"]);
  });

  it("honours the escape directive", () => {
    const containerfile = parseContainerfile("# escape=`\nFROM mcr.microsoft.com/windows:ltsc\nRUN dir `\n  c:\\\n");
    expect(containerfile.instructions[1]?.args).toBe("dir c:\\");
  });

  it("refuses an oversized file", () => {
    expect(() => parseContainerfile("#".repeat(300_000))).toThrow(/larger than/);
  });
});
