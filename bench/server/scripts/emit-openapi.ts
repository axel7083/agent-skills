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

/**
 * Writes the server's OpenAPI document to bench/server/openapi/openapi.json without starting
 * anything: Nest's preview mode resolves routes and metadata but instantiates no provider (no
 * database, no Bifrost). The runner's client is generated from this file; CI fails on drift.
 */
import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { NodeAdapter } from "@nestjs/platform-node";
import { AppModule } from "../src/app.module.ts";
import { openApiDocument } from "../src/openapi.ts";

const app = await NestFactory.create(AppModule, new NodeAdapter(), { preview: true, abortOnError: false, logger: false });
const out = join(process.cwd(), "openapi", "openapi.json");
await writeFile(out, `${JSON.stringify(openApiDocument(app), null, 2)}\n`);
console.info(`wrote ${out}`);
// Preview mode started nothing: nothing to release.
process.exit(0);
