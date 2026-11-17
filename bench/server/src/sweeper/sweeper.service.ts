import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { KeysService } from "../keys/keys.service.ts";
import { RunsService } from "../runs/runs.service.ts";

/**
 * Keys must not outlive their runs: a job killed before it revoked its key, a run never completed.
 * Works from the server's own records and Bifrost only, never GitHub's API.
 */
@Injectable()
export class SweeperService {
  private readonly logger = new Logger(SweeperService.name);
  private running = false;

  constructor(
    private readonly runs: RunsService,
    private readonly keys: KeysService,
  ) {}

  @Interval(60_000)
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runs.abandonStale();
      await this.keys.sweep();
    } catch (error: unknown) {
      this.logger.error(`sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
