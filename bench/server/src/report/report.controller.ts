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
import { CONTENT_SECURITY_POLICY, renderReportHtml } from "@podman-desktop/agent-skills-bench-report";
import { RunsService } from "../runs/runs.service.ts";

/** Where the report's bundled script and stylesheet are served (main.ts). */
export const ASSETS_PREFIX = "/assets";

@ApiTags("report")
@Controller("runs")
@UseGuards(ThrottlerGuard)
export class ReportController {
  constructor(private readonly runs: RunsService) {}

  @Get(":run")
  @Header("content-type", "text/html; charset=utf-8")
  @Header("content-security-policy", `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`)
  @Header("x-content-type-options", "nosniff")
  @Header("referrer-policy", "no-referrer")
  @Header("cache-control", "public, max-age=300")
  @ApiOperation({ operationId: "getReport", summary: "A completed run's report page" })
  @ApiParam({ name: "run", format: "uuid" })
  @ApiProduces("text/html")
  @ApiResponse({ status: 200, description: "HTML" })
  async report(@Param("run", new ParseUUIDPipe()) run: string): Promise<string> {
    const [results, trials] = await Promise.all([this.runs.results(run), this.runs.trials(run)]);
    return renderReportHtml({ results, trials, scriptUrl: `${ASSETS_PREFIX}/report.js`, styleUrl: `${ASSETS_PREFIX}/report.css` });
  }
}
