CREATE TABLE "planet_insights" (
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'absent' NOT NULL,
	"content" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "planet_insights_ready_has_content" CHECK ((("planet_insights"."status" = 'ready' and "planet_insights"."content" is not null) or ("planet_insights"."status" <> 'ready' and "planet_insights"."content" is null)))
);
--> statement-breakpoint
ALTER TABLE "planet_insights" ADD CONSTRAINT "planet_insights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planet_insights_user_id_date_idx" ON "planet_insights" USING btree ("user_id","date");