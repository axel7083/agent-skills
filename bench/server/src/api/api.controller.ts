import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { PublishedTrial, type Results, Results as ResultsSchema, RunDetail, RunSummary, EvalSpec, Trial } from "@podman-desktop/bench-contracts";
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
    results: ResultsSchema,
    eval: EvalSpec,
  }).map(([name, schema]) => [name, z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" })]),
);

/** The raw-data API: public and read-only, served from what the server stored. */
@Controller("api/v1")
@UseGuards(ThrottlerGuard)
export class ApiController {
  constructor(private readonly runs: RunsService) {}

  @Get("runs")
  @Header("cache-control", "public, max-age=30")
  async list(): Promise<{ schemaVersion: 1; runs: RunSummary[] }> {
    return { schemaVersion: 1, runs: await this.runs.list() };
  }

  @Get("runs/:run")
  @Header("cache-control", "public, max-age=30")
  detail(@Param("run", new ParseUUIDPipe()) run: string): Promise<RunDetail> {
    return this.runs.detail(run);
  }

  /** One trial per line. */
  @Get("runs/:run/trials")
  @Header("content-type", "application/x-ndjson; charset=utf-8")
  @Header("cache-control", "public, max-age=300")
  async trials(@Param("run", new ParseUUIDPipe()) run: string): Promise<string> {
    const trials = await this.runs.trials(run);
    return trials.map((trial) => JSON.stringify(trial)).join("\n") + "\n";
  }

  @Get("runs/:run/results")
  @Header("cache-control", "public, max-age=300")
  results(@Param("run", new ParseUUIDPipe()) run: string): Promise<Results> {
    return this.runs.results(run);
  }

  @Get("schema/v1/:name")
  @Header("content-type", "application/schema+json")
  @Header("cache-control", "public, max-age=3600")
  schema(@Param("name") name: string): unknown {
    const schema = /^([a-z-]+)\.json$/.exec(name)?.[1];
    if (schema === undefined || !Object.hasOwn(SCHEMAS, schema)) throw new NotFound(`schema ${name}`);
    return SCHEMAS[schema];
  }
}
