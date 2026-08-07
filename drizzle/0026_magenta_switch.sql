ALTER TABLE "compatibility_people_scores" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ADD COLUMN "status" text DEFAULT 'absent' NOT NULL;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" DROP COLUMN "overview";--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" DROP COLUMN "positive_overview";--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" DROP COLUMN "negative_overview";--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" DROP COLUMN "insights";--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" DROP COLUMN "practical_advice";--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" DROP COLUMN "raw_input";--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ADD CONSTRAINT "compatibility_people_scores_ready_has_content" CHECK ((("compatibility_people_scores"."status" = 'ready' and "compatibility_people_scores"."content" is not null) or ("compatibility_people_scores"."status" <> 'ready' and "compatibility_people_scores"."content" is null)));