import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { NodeRequest } from "@nestjs/platform-node";
import { OidcRejected } from "../common/errors.ts";
import { OidcVerifier, type Principal, type Stage } from "./oidc-verifier.ts";

const STAGE = Symbol("STAGE");
const PRINCIPAL = Symbol("PRINCIPAL");

type AuthenticatedRequest = NodeRequest & { [PRINCIPAL]?: Principal };

@Injectable()
export class OidcGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: OidcVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const stage = this.reflector.get<Stage | undefined>(STAGE, context.getHandler());
    if (stage === undefined) throw new Error("OidcGuard on a handler without @ForStage()");
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
    if (token === undefined) throw new OidcRejected("missing bearer token");
    request[PRINCIPAL] = await this.verifier.verify(token, stage);
    return true;
  }
}

/** The handler may only be called by the given stage's job of the bench workflow. */
export function ForStage(stage: Stage): MethodDecorator {
  return applyDecorators(SetMetadata(STAGE, stage), UseGuards(OidcGuard));
}

/** The verified caller, set by `@ForStage()`. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const principal = context.switchToHttp().getRequest<AuthenticatedRequest>()[PRINCIPAL];
  if (principal === undefined) throw new OidcRejected("no verified principal");
  return principal;
});
