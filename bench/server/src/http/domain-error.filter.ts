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

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from "@nestjs/common";
import type { NodeResponse } from "@nestjs/platform-node";
import { BudgetExceeded, Conflict, DomainError, Forbidden, NotFound, OidcRejected, Refused, UpstreamError } from "../common/errors.ts";

/**
 * Maps expected failures to statuses. The body only carries a code: callers are workflow jobs,
 * the reason is in the server's log.
 */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<NodeResponse>();
    const status = statusOf(error);
    this.logger.warn(`${String(status)} ${error.code}: ${error.message}`);
    response.status(status).json({ error: error.code });
  }
}

function statusOf(error: DomainError): number {
  if (error instanceof OidcRejected) return HttpStatus.UNAUTHORIZED;
  if (error instanceof Forbidden) return HttpStatus.FORBIDDEN;
  if (error instanceof NotFound) return HttpStatus.NOT_FOUND;
  if (error instanceof Conflict) return HttpStatus.CONFLICT;
  if (error instanceof BudgetExceeded) return HttpStatus.PAYMENT_REQUIRED;
  if (error instanceof UpstreamError) return HttpStatus.BAD_GATEWAY;
  if (error instanceof Refused) return HttpStatus.UNPROCESSABLE_ENTITY;
  return HttpStatus.UNPROCESSABLE_ENTITY;
}
