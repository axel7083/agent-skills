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

import { existsSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

/** Same major as production. */
const IMAGE = "docker.io/library/postgres:18-alpine";

/** A throwaway Postgres; with rootless Podman when its socket is there and nothing else is configured. */
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  const socket = `${process.env["XDG_RUNTIME_DIR"] ?? ""}/podman/podman.sock`;
  if (process.env["DOCKER_HOST"] === undefined && existsSync(socket)) {
    process.env["DOCKER_HOST"] = `unix://${socket}`;
    process.env["TESTCONTAINERS_RYUK_DISABLED"] = "true";
  }
  return new PostgreSqlContainer(IMAGE).withDatabase("bench").withUsername("bench").withPassword("bench").start();
}

/**
 * Stops the container, logging instead of failing when the engine can't clean up: rootless Podman on
 * GitHub's runners sometimes refuses to tear down its network namespace ("rootless netns: kill
 * network process: permission denied") once the tests have passed.
 */
export async function stopPostgres(container: StartedPostgreSqlContainer | undefined): Promise<void> {
  await container?.stop().catch((error: unknown) => {
    console.warn(`stopping Postgres failed, left to the runner: ${String(error)}`);
  });
}
