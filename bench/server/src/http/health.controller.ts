import { Controller, Get } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { sql } from "drizzle-orm";
import type { Db } from "../db/db.module.ts";

@Controller("healthz")
export class HealthController {
  constructor(@InjectDrizzle() private readonly db: Db) {}

  @Get()
  async health(): Promise<{ status: "ok" }> {
    await this.db.execute(sql`select 1`);
    return { status: "ok" };
  }
}
