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

import { join } from "node:path";
import { Global, Logger, Module } from "@nestjs/common";
import { DrizzleModule } from "@nestjs/drizzle";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pRetry from "p-retry";
import type { Pool, PoolClient } from "pg";
import { APP_ENV, type AppEnv } from "../config/env.ts";

/** The application's database handle. Inject with `@InjectDrizzle()`. */
export type Db = NodePgDatabase & { readonly $client: Pool };

/** Shipped next to dist/ in the image: bench/server/drizzle. */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, "..", "..", "drizzle");

/** Serialises migrations when several instances start at once. */
const MIGRATION_LOCK = 7_207_101;

/** Connects, and brings the schema up to date before anything can use it. */
export async function connectAndMigrate(databaseUrl: string): Promise<Db> {
  const logger = new Logger("Database");
  const db = drizzle({ connection: { connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 } });
  const client = await firstConnection(db.$client, logger);
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.log("schema up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return db;
}

/** Postgres may still be starting: retry for up to a minute. */
function firstConnection(pool: Pool, logger: Logger): Promise<PoolClient> {
  return pRetry(() => pool.connect(), {
    retries: Number.POSITIVE_INFINITY,
    maxRetryTime: 60_000,
    minTimeout: 250,
    maxTimeout: 5_000,
    onFailedAttempt: ({ attemptNumber }) => {
      logger.warn(`database not reachable yet (attempt ${String(attemptNumber)}), retrying`);
    },
  });
}

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: async (env: AppEnv) => ({ db: await connectAndMigrate(env.DATABASE_URL) }),
    }),
  ],
  exports: [DrizzleModule],
})
export class DbModule {}
