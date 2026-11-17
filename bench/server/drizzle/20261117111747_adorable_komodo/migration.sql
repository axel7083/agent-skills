CREATE TYPE "key_state" AS ENUM('active', 'disabled', 'settled');--> statement-breakpoint
CREATE TYPE "run_status" AS ENUM('running', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"shard" text NOT NULL,
	"attempt" integer NOT NULL,
	"virtual_key_id" text NOT NULL,
	"limit_usd" double precision NOT NULL,
	"state" "key_state" DEFAULT 'active'::"key_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"disabled_at" timestamp with time zone,
	"usage_usd" double precision,
	"usage_tokens" bigint
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"github_run_id" bigint NOT NULL,
	"actor_id" bigint NOT NULL,
	"request" jsonb NOT NULL,
	"max_usd" double precision NOT NULL,
	"status" "run_status" DEFAULT 'running'::"run_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"results" jsonb,
	"cost_usd" double precision
);
--> statement-breakpoint
CREATE TABLE "shards" (
	"run_id" uuid,
	"id" text,
	"harness" text NOT NULL,
	"model" text NOT NULL,
	"arm" text NOT NULL,
	"task" text NOT NULL,
	CONSTRAINT "shards_pkey" PRIMARY KEY("run_id","id")
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"run_id" uuid,
	"shard" text,
	"attempt" integer,
	"trial" integer,
	"data" jsonb NOT NULL,
	"artifact_id" bigint NOT NULL,
	"cost_usd" double precision,
	CONSTRAINT "trials_pkey" PRIMARY KEY("run_id","shard","attempt","trial")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "keys_run_shard_attempt" ON "keys" ("run_id","shard","attempt");--> statement-breakpoint
CREATE INDEX "keys_state" ON "keys" ("state");--> statement-breakpoint
CREATE INDEX "keys_created_at" ON "keys" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_github_run_id" ON "runs" ("github_run_id");--> statement-breakpoint
CREATE INDEX "runs_status" ON "runs" ("status");--> statement-breakpoint
ALTER TABLE "keys" ADD CONSTRAINT "keys_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shards" ADD CONSTRAINT "shards_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_run_id_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE;