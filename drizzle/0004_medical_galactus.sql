CREATE TABLE "compatibility_people" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"gender" text NOT NULL,
	"relationship" text NOT NULL,
	"birth_date" date NOT NULL,
	"birth_time" time,
	"birth_place" text,
	"birth_place_lat" double precision,
	"birth_place_lng" double precision,
	"timezone" text,
	"image" text,
	"sun_sign" text NOT NULL,
	"moon_sign" text,
	"rising_sign" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compatibility_people_scores" (
	"date" date NOT NULL,
	"person_id" text NOT NULL,
	"score" numeric DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compatibility_people" ADD CONSTRAINT "compatibility_people_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibility_people_scores" ADD CONSTRAINT "compatibility_people_scores_person_id_compatibility_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."compatibility_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compatibility_people_user_id_idx" ON "compatibility_people" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compatibility_people_scores_person_date_idx" ON "compatibility_people_scores" USING btree ("person_id","date");