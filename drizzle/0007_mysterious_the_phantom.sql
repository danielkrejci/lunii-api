ALTER TABLE "profile" ADD COLUMN "birth_place_lat" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "birth_place_lng" double precision NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_providerAccountId_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "profile_birth_place_lat_lng_idx" ON "profile" USING btree ("birth_place_lat","birth_place_lng");--> statement-breakpoint
CREATE INDEX "profile_notification_token_idx" ON "profile" USING btree ("notification_token");--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_unique" UNIQUE("user_id");