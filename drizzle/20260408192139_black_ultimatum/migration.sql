CREATE TABLE "profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"birth_date" timestamp NOT NULL,
	"birth_time" text NOT NULL,
	"birth_place" text NOT NULL,
	"gender" text NOT NULL,
	"zodiac_sign" text NOT NULL,
	"relationship_status" text NOT NULL,
	"career_stage" text NOT NULL,
	"decision_style" text NOT NULL,
	"areas_of_interest" text NOT NULL,
	"goals_for_the_year" text NOT NULL,
	"content_preference" text NOT NULL,
	"belief_level" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "birth_date";