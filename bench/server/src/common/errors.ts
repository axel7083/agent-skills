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

/** Failures the server expects; the filter maps each to a status and a generic code. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The OIDC token is missing, invalid, or not from the bench workflow. */
export class OidcRejected extends DomainError {
  readonly code = "oidc_rejected";
}

/** A valid token, but not allowed here: another stage, another run. */
export class Forbidden extends DomainError {
  readonly code = "forbidden";
}

export class NotFound extends DomainError {
  readonly code = "not_found";
}

/** Already done once: a key is minted once per shard and attempt, a run created once. */
export class Conflict extends DomainError {
  readonly code = "conflict";
}

export class BudgetExceeded extends DomainError {
  readonly code = "budget_exceeded";
}

/** The request is well-formed but can't be honoured (a model without a price, too many shards). */
export class Refused extends DomainError {
  readonly code = "refused";
}

export class UpstreamError extends DomainError {
  readonly code = "upstream_error";

  constructor(
    readonly upstream: string,
    message: string,
    readonly status: number | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
