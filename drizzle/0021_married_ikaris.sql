ALTER TABLE "daily_insights" ADD COLUMN "raw_scores" jsonb;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "confidence" numeric;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "score_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "engine_version" text;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "calibration_version" text;