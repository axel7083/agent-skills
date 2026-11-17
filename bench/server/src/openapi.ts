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

import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";

/** Where the server publishes its own document, next to the raw-data API. */
export const OPENAPI_PATH = "api/v1/openapi.json";

/**
 * The server's OpenAPI document. Request and response schemas come from the contracts' zod
 * schemas (Standard Schema): the clients generated from it validate what they send and receive.
 */
export function openApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("agent-skills bench server")
    .setDescription(
      "The bench workflow's jobs call /v1/* with a GitHub Actions OIDC token, each job's environment allowing its own endpoints only. /api/v1/* is the public, read-only raw-data API.",
    )
    .setVersion("1")
    .setLicense("Apache-2.0", "https://www.apache.org/licenses/LICENSE-2.0")
    .addBearerAuth({ type: "http", scheme: "bearer", description: "GitHub Actions OIDC token, audience = the server's PUBLIC_URL" }, "oidc")
    .build();
  return SwaggerModule.createDocument(app, config);
}
