ALTER TABLE "daily_insights" ALTER COLUMN "overview" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "moon" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "love_insight" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "career_insight" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "health_insight" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "mood_insight" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "overall_insight" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "opportunity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "watch_out" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "deep_insight" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "raw_response" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "raw_input" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "daily_insights" ALTER COLUMN "raw_input" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "personality_profile_input" DROP DEFAULT;