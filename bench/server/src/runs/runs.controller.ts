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

import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  CompleteRunResponse,
  CreateRunRequest,
  CreateRunResponse,
  ErrorBody,
  MintedKey,
  Slug,
  UploadTrialsRequest,
} from "@podman-desktop/agent-skills-bench-contracts";
import { CurrentPrincipal, ForStage } from "../auth/oidc.guard.ts";
import type { Principal } from "../auth/oidc-verifier.ts";
import { Refused } from "../common/errors.ts";
import { KeysService } from "../keys/keys.service.ts";
import { RunsService } from "./runs.service.ts";

const RUN = { name: "run", description: "The run's id, from createRun", format: "uuid" } as const;
const SHARD = { name: "shard", description: "A shard id from the run's matrix, e.g. s001" } as const;

/** The bench workflow's endpoints, each callable by one stage's job only (OIDC `environment`). */
@ApiTags("workflow")
@ApiBearerAuth("oidc")
@ApiResponse({ status: 401, description: "OIDC token missing, invalid, or not from the bench workflow on main", standardSchema: ErrorBody })
@ApiResponse({ status: 403, description: "Another stage's token, another workflow run, or an actor not allowed", standardSchema: ErrorBody })
@Controller("v1/runs")
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly keys: KeysService,
  ) {}

  @Post()
  @ForStage("plan")
  @ApiOperation({ operationId: "createRun", summary: "Register the workflow run and expand its matrix (plan job)" })
  @ApiResponse({ status: 201, standardSchema: CreateRunResponse })
  @ApiResponse({ status: 402, description: "The daily cap is spent", standardSchema: ErrorBody })
  @ApiResponse({ status: 409, description: "Another run is still running", standardSchema: ErrorBody })
  @ApiResponse({ status: 422, description: "A model without a price, too many shards, or a missing arm", standardSchema: ErrorBody })
  create(@Body({ schema: CreateRunRequest }) body: CreateRunRequest, @CurrentPrincipal() principal: Principal): Promise<CreateRunResponse> {
    return this.runs.create(body, principal);
  }

  @Post(":run/shards/:shard/key")
  @ForStage("agent")
  @ApiOperation({ operationId: "mintKey", summary: "Mint the shard's budget-capped LLM key for this attempt (agent job)" })
  @ApiParam(RUN)
  @ApiParam(SHARD)
  @ApiResponse({ status: 201, standardSchema: MintedKey })
  @ApiResponse({ status: 402, description: "The run's or the daily cap is spent", standardSchema: ErrorBody })
  @ApiResponse({ status: 409, description: "This shard already has a key for this attempt, or the run is closed", standardSchema: ErrorBody })
  mint(@Param("run", new ParseUUIDPipe()) run: string, @Param("shard") shard: string, @CurrentPrincipal() principal: Principal): Promise<MintedKey> {
    return this.keys.mint(run, shardId(shard), principal);
  }

  @Delete(":run/shards/:shard/key")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ForStage("agent")
  @ApiOperation({ operationId: "revokeKey", summary: "Stop spending on the shard's key (agent job); usage is settled later" })
  @ApiParam(RUN)
  @ApiParam(SHARD)
  @ApiResponse({ status: 204, description: "Disabled" })
  @ApiResponse({ status: 404, description: "No key for this shard and attempt", standardSchema: ErrorBody })
  revoke(@Param("run", new ParseUUIDPipe()) run: string, @Param("shard") shard: string, @CurrentPrincipal() principal: Principal): Promise<void> {
    return this.keys.revoke(run, shardId(shard), principal);
  }

  @Post(":run/trials")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ForStage("upload")
  @ApiOperation({ operationId: "uploadTrials", summary: "Store one shard's graded trials (complete job)" })
  @ApiParam(RUN)
  @ApiResponse({ status: 204, description: "Stored, replacing a previous upload of the same attempt" })
  @ApiResponse({ status: 422, description: "A trial that doesn't belong to the shard", standardSchema: ErrorBody })
  upload(
    @Param("run", new ParseUUIDPipe()) run: string,
    @Body({ schema: UploadTrialsRequest }) body: UploadTrialsRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    return this.runs.uploadTrials(run, body, principal);
  }

  @Post(":run/complete")
  @HttpCode(HttpStatus.OK)
  @ForStage("upload")
  @ApiOperation({ operationId: "completeRun", summary: "Settle the run's keys, compute its results and close it (complete job)" })
  @ApiParam(RUN)
  @ApiResponse({ status: 200, standardSchema: CompleteRunResponse })
  complete(@Param("run", new ParseUUIDPipe()) run: string, @CurrentPrincipal() principal: Principal): Promise<CompleteRunResponse> {
    return this.runs.complete(run, principal);
  }
}

function shardId(value: string): string {
  const parsed = Slug.safeParse(value);
  if (!parsed.success) throw new Refused("invalid shard id");
  return parsed.data;
}
