ALTER TABLE "compatibility_people_scores"
ALTER COLUMN "positive_overview"
TYPE jsonb
USING "positive_overview"::jsonb;

--> statement-breakpoint

ALTER TABLE "compatibility_people_scores"
ALTER COLUMN "negative_overview"
TYPE jsonb
USING "negative_overview"::jsonb;