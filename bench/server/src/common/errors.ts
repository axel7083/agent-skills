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
