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
