ALTER TABLE "profile" ADD COLUMN "notification_token" text;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "created_at" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "updated_at" timestamp;