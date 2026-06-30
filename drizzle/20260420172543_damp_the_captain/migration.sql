ALTER TABLE "profile" ADD COLUMN IF NOT EXISTS "country" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN IF NOT EXISTS "language" text NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_insights_user_id_date_idx" ON "daily_insights" USING btree ("user_id","date");