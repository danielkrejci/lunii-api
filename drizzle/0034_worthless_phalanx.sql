CREATE TABLE "generation_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"shard_key" text NOT NULL,
	"provider_batch_id" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"item_count" integer NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"target_date" date NOT NULL,
	"content_type" text NOT NULL,
	"pass" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "last_active_at" timestamp;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_run_id_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_batches_run_shard_idx" ON "generation_batches" USING btree ("run_id","shard_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_runs_date_type_pass_idx" ON "generation_runs" USING btree ("target_date","content_type","pass");--> statement-breakpoint
CREATE INDEX "profile_last_active_at_idx" ON "profile" USING btree ("last_active_at");