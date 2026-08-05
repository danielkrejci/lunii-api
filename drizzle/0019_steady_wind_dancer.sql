ALTER TABLE "daily_insights" ADD COLUMN "overall_score" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "overall_insight" jsonb NOT NULL;