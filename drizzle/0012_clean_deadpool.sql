ALTER TABLE "compatibility_people_scores" ALTER COLUMN "overview" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ALTER COLUMN "positive_overview" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ALTER COLUMN "negative_overview" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ALTER COLUMN "practical_advice" DROP NOT NULL;