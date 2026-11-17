---
name: containerfile-best-practices
description: Write or fix a Containerfile (or Dockerfile) so the image is reproducible, secure and runs on Podman and OpenShift. Use when creating, reviewing or repairing a Containerfile, Dockerfile or .containerignore, or when an image fails on OpenShift with permission errors.
license: Apache-2.0
compatibility: Podman 5.0+
metadata:
  version: "0.1.0"
---

# Containerfile best practices

Apply every rule below whenever you write or change a container build file, even when the request
only asks for "a container that runs". Then build and run the image with Podman to check it works.

## Naming

- Name the build file `Containerfile`. When you repair an existing `Dockerfile`, rename it to
  `Containerfile` (`git mv` if the project uses git): Podman and Buildah read `Containerfile` first.
- Add a `.containerignore` next to it (not `.dockerignore`) excluding at least secrets (`.env`,
  `*.pem`), VCS data (`.git`) and local dependencies (`node_modules`, `.venv`, `__pycache__`).

## Base images

- Use **fully qualified** names: `docker.io/library/node:22-slim`, not `node:22-slim`. Short names
  depend on each host's registry search list and can resolve to another image.
- Pin every base image by **tag and digest**: `docker.io/library/node:22-slim@sha256:<digest>`.
  Get the digest with `skopeo inspect --format '{{.Digest}}' docker://<image>:<tag>` or
  `podman pull <image>:<tag> && podman image inspect --format '{{.Digest}}' <image>:<tag>`.
  Keep the tag for readers and update bots; the digest is what gets built.
- Prefer small, maintained bases (`registry.access.redhat.com/ubi10/ubi-minimal`, `-slim` variants,
  distroless) and use a multi-stage build when the app compiles.

## Runtime

- Declare a `HEALTHCHECK` in the final stage that probes the service, using a tool the image
  ships (`curl`, `wget`, or the runtime itself: `node -e "fetch(...)"`, `python -c "urllib..."`).
  Podman keeps it in the image with `podman build --format docker`.
- Run as a non-root user with a **numeric** UID: `USER 1001`, not `USER node`. Platforms that enforce
  `runAsNonRoot` can only verify a number.
- Use the exec (JSON) form for `CMD` and `ENTRYPOINT` so signals reach the app.
- Never copy secrets into the image: copy only the files the app needs, and keep `.env` out through
  `.containerignore`.

## OpenShift

OpenShift starts containers with an arbitrary UID that belongs to group 0 (root group), with no
capabilities and no ports below 1024. For the image to work there:

- Make every directory the app writes to owned by group 0 and group-writable, in the same layer
  that creates it:
  ```Containerfile
  RUN mkdir -p /app/data && chgrp -R 0 /app/data && chmod -R g=u /app/data
  ```
  Never `chmod 777`.
- Listen on a port of 1024 or more (e.g. 8080) and `EXPOSE` it.
- Keep `USER` numeric (see above).

## Check your work

```sh
podman build --format docker -t localhost/app:dev .
podman run -d --rm --name app -p 8080:8080 localhost/app:dev
curl -fsS http://127.0.0.1:8080/health && podman healthcheck run app
# OpenShift: run as an arbitrary UID in group 0, without capabilities
podman run -d --rm --user 40713:0 --cap-drop=all -p 8081:8080 localhost/app:dev
```
