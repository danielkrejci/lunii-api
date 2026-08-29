CREATE TABLE "moon_insights" (
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'absent' NOT NULL,
	"variant" text NOT NULL,
	"content" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "moon_insights_ready_has_content" CHECK ((("moon_insights"."status" = 'ready' and "moon_insights"."content" is not null) or ("moon_insights"."status" <> 'ready' and "moon_insights"."content" is null)))
);
--> statement-breakpoint
ALTER TABLE "moon_insights" ADD CONSTRAINT "moon_insights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moon_insights_user_id_date_idx" ON "moon_insights" USING btree ("user_id","date");