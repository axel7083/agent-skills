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

import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  ErrorBody,
  EvalSpec,
  PublishedTrial,
  Results,
  RunDetail,
  RunList,
  RunSummary,
  Trial,
} from "@podman-desktop/agent-skills-bench-contracts";
import { z } from "zod";
import { NotFound } from "../common/errors.ts";
import { RunsService } from "../runs/runs.service.ts";

/** JSON Schema of every published document, generated from the contracts at startup. */
const SCHEMAS: Readonly<Record<string, unknown>> = Object.fromEntries(
  Object.entries({
    run: RunDetail,
    "run-summary": RunSummary,
    trial: Trial,
    "published-trial": PublishedTrial,
    results: Results,
    eval: EvalSpec,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" })]),
);

const RUN = { name: "run", description: "A run id", format: "uuid" } as const;

/** The raw-data API: public and read-only, served from what the server stored. */
@ApiTags("raw-data")
@ApiResponse({ status: 429, description: "Too many requests", standardSchema: ErrorBody })
@Controller("api/v1")
@UseGuards(ThrottlerGuard)
export class ApiController {
  constructor(private readonly runs: RunsService) {}

  @Get("runs")
  @Header("cache-control", "public, max-age=30")
  @ApiOperation({ operationId: "listRuns", summary: "Every run, newest first" })
  @ApiResponse({ status: 200, standardSchema: RunList })
  async list(): Promise<RunList> {
    return { schemaVersion: 1, runs: await this.runs.list() };
  }

  @Get("runs/:run")
  @Header("cache-control", "public, max-age=30")
  @ApiOperation({ operationId: "getRun", summary: "A run: its inputs, shards and gateway billing" })
  @ApiParam(RUN)
  @ApiResponse({ status: 200, standardSchema: RunDetail })
  @ApiResponse({ status: 404, standardSchema: ErrorBody })
  detail(@Param("run", new ParseUUIDPipe()) run: string): Promise<RunDetail> {
    return this.runs.detail(run);
  }

  @Get("runs/:run/trials")
  @Header("content-type", "application/x-ndjson; charset=utf-8")
  @Header("cache-control", "public, max-age=300")
  @ApiOperation({
    operationId: "getRunTrials",
    summary: "A completed run's trials, one JSON document per line",
    description: "Each line validates against /api/v1/schema/v1/published-trial.json.",
  })
  @ApiParam(RUN)
  @ApiProduces("application/x-ndjson")
  @ApiResponse({ status: 200, description: "NDJSON, one PublishedTrial per line" })
  @ApiResponse({ status: 404, standardSchema: ErrorBody })
  async trials(@Param("run", new ParseUUIDPipe()) run: string): Promise<string> {
    const trials = await this.runs.trials(run);
    return trials.map((trial) => JSON.stringify(trial)).join("\n") + "\n";
  }

  @Get("runs/:run/results")
  @Header("cache-control", "public, max-age=300")
  @ApiOperation({ operationId: "getRunResults", summary: "A completed run's aggregates: what the report shows" })
  @ApiParam(RUN)
  @ApiResponse({ status: 200, standardSchema: Results })
  @ApiResponse({ status: 404, standardSchema: ErrorBody })
  results(@Param("run", new ParseUUIDPipe()) run: string): Promise<Results> {
    return this.runs.results(run);
  }

  @Get("schema/v1/:name")
  @Header("content-type", "application/schema+json")
  @Header("cache-control", "public, max-age=3600")
  @ApiOperation({ operationId: "getSchema", summary: "JSON Schema of a published document" })
  @ApiParam({ name: "name", enum: Object.keys(SCHEMAS).map((schema) => `${schema}.json`) })
  @ApiResponse({ status: 200, description: "A JSON Schema (draft 2020-12)" })
  @ApiResponse({ status: 404, standardSchema: ErrorBody })
  schema(@Param("name") name: string): unknown {
    const schema = /^([a-z-]+)\.json$/.exec(name)?.[1];
    if (schema === undefined || !Object.hasOwn(SCHEMAS, schema)) throw new NotFound(`schema ${name}`);
    return SCHEMAS[schema];
  }
}
