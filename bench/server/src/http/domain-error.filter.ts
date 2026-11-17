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
