import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NodeAdapter, type NestNodeApplication } from "@nestjs/platform-node";
import { Logger } from "nestjs-pino";
import { configure } from "./app.ts";
import { AppModule } from "./app.module.ts";
import { APP_ENV, type AppEnv } from "./config/env.ts";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestNodeApplication>(AppModule, new NodeAdapter(), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configure(app);
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  const env = app.get<AppEnv>(APP_ENV);
  await app.listen(env.PORT, "0.0.0.0");
}

await bootstrap();
