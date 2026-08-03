ALTER TABLE "daily_insights" ADD COLUMN "raw_input" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "personality_profile_input" text DEFAULT '' NOT NULL;