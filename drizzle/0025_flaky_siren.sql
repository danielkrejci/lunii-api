ALTER TABLE "daily_insights" ADD COLUMN "status" text DEFAULT 'absent' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "overview";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "moon";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "love_insight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "career_insight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "health_insight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "mood_insight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "overall_insight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "opportunity";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "watch_out";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "deep_insight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "planets";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "raw_scores";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "confidence";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "score_breakdown";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "engine_version";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "calibration_version";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "raw_response";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "raw_input";--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_ready_has_content" CHECK ((("daily_insights"."status" = 'ready' and "daily_insights"."content" is not null) or ("daily_insights"."status" <> 'ready' and "daily_insights"."content" is null)));