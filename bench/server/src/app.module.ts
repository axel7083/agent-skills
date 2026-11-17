import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { ApiController } from "./api/api.controller.ts";
import { OidcGuard } from "./auth/oidc.guard.ts";
import { githubJwks, OIDC_KEYS, OidcVerifier } from "./auth/oidc-verifier.ts";
import { APP_ENV, type AppEnv, parseEnv } from "./config/env.ts";
import { EnvModule } from "./config/env.module.ts";
import { DbModule } from "./db/db.module.ts";
import { HealthController } from "./http/health.controller.ts";
import { BifrostClient } from "./keys/bifrost.client.ts";
import { KeysService } from "./keys/keys.service.ts";
import { PriceList } from "./keys/prices.ts";
import { ReportController } from "./report/report.controller.ts";
import { RunsController } from "./runs/runs.controller.ts";
import { RunsService } from "./runs/runs.service.ts";
import { SweeperService } from "./sweeper/sweeper.service.ts";

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      useFactory: () => {
        const env = parseEnv(process.env);
        return {
          pinoHttp: {
            level: env.LOG_LEVEL,
            // OIDC tokens and LLM keys never reach the log.
            redact: ["req.headers.authorization", "res.headers"],
            autoLogging: { ignore: (request) => request.url === "/healthz" },
          },
        };
      },
    }),
    DbModule,
    ScheduleModule.forRoot(),
    // Public pages and API: 120 requests a minute per client.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [RunsController, ApiController, ReportController, HealthController],
  providers: [
    { provide: OIDC_KEYS, useFactory: githubJwks },
    OidcVerifier,
    OidcGuard,
    { provide: PriceList, inject: [APP_ENV], useFactory: (env: AppEnv) => PriceList.fromFile(env.PRICES_FILE) },
    {
      provide: BifrostClient,
      inject: [APP_ENV, PriceList],
      useFactory: (env: AppEnv, prices: PriceList) =>
        new BifrostClient(
          {
            adminUrl: env.BIFROST_ADMIN_URL,
            username: env.BIFROST_ADMIN_USERNAME,
            password: env.BIFROST_ADMIN_PASSWORD,
            provider: env.BIFROST_PROVIDER,
            requestsPerMinute: env.KEY_REQUESTS_PER_MINUTE,
          },
          prices,
        ),
    },
    KeysService,
    RunsService,
    SweeperService,
  ],
})
export class AppModule {}
