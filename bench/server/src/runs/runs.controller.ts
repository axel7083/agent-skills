import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { type CompleteRunResponse, CreateRunRequest, type CreateRunResponse, type MintedKey, Slug, UploadTrialsRequest } from "@podman-desktop/bench-contracts";
import { CurrentPrincipal, ForStage } from "../auth/oidc.guard.ts";
import type { Principal } from "../auth/oidc-verifier.ts";
import { Refused } from "../common/errors.ts";
import { KeysService } from "../keys/keys.service.ts";
import { RunsService } from "./runs.service.ts";

/** The bench workflow's endpoints, each callable by one stage's job only (OIDC `environment`). */
@Controller("v1/runs")
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly keys: KeysService,
  ) {}

  @Post()
  @ForStage("plan")
  create(@Body({ schema: CreateRunRequest }) body: CreateRunRequest, @CurrentPrincipal() principal: Principal): Promise<CreateRunResponse> {
    return this.runs.create(body, principal);
  }

  @Post(":run/shards/:shard/key")
  @ForStage("agent")
  mint(@Param("run", new ParseUUIDPipe()) run: string, @Param("shard") shard: string, @CurrentPrincipal() principal: Principal): Promise<MintedKey> {
    return this.keys.mint(run, shardId(shard), principal);
  }

  @Delete(":run/shards/:shard/key")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ForStage("agent")
  revoke(@Param("run", new ParseUUIDPipe()) run: string, @Param("shard") shard: string, @CurrentPrincipal() principal: Principal): Promise<void> {
    return this.keys.revoke(run, shardId(shard), principal);
  }

  @Post(":run/trials")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ForStage("upload")
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
  complete(@Param("run", new ParseUUIDPipe()) run: string, @CurrentPrincipal() principal: Principal): Promise<CompleteRunResponse> {
    return this.runs.complete(run, principal);
  }
}

function shardId(value: string): string {
  const parsed = Slug.safeParse(value);
  if (!parsed.success) throw new Refused("invalid shard id");
  return parsed.data;
}
