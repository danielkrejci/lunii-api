ALTER TABLE "compatibility_people" ADD COLUMN "base_score" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibility_people" ADD COLUMN "base_compatibility" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ADD COLUMN "compatibility" jsonb NOT NULL;