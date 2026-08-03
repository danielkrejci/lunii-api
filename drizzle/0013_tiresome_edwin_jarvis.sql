ALTER TABLE "daily_insights" ADD COLUMN "overview" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "moon" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "love_score" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "love_insight" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "career_score" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "career_insight" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "health_score" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "health_insight" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "mood_score" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "mood_insight" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "opportunity" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "watch_out" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "deep_insight" text NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "raw_response" text NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "focus";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "caution";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "do";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "avoid";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "horoscope";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "moonInsight";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "score_love";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "score_career";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "score_health";--> statement-breakpoint
ALTER TABLE "daily_insights" DROP COLUMN "score_mood";