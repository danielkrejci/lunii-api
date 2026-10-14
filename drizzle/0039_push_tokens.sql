CREATE TABLE "push_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_token_token_unique" UNIQUE("token"),
	CONSTRAINT "push_token_platform_valid" CHECK ("push_token"."platform" in ('ios', 'android'))
);
--> statement-breakpoint
DROP INDEX "profile_notification_token_idx";--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_token_user_id_idx" ON "push_token" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "notification_token";