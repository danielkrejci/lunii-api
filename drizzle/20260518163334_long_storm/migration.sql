ALTER TABLE "daily_insights" ADD COLUMN "score_love" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "score_career" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "score_health" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD COLUMN "score_mood" numeric DEFAULT '0' NOT NULL;