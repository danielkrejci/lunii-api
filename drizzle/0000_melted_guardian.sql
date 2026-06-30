CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_insights" (
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"focus" text[] NOT NULL,
	"caution" text[] NOT NULL,
	"do" text NOT NULL,
	"avoid" text NOT NULL,
	"horoscope" text NOT NULL,
	"score_love" numeric DEFAULT '0' NOT NULL,
	"score_career" numeric DEFAULT '0' NOT NULL,
	"score_health" numeric DEFAULT '0' NOT NULL,
	"score_mood" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"referrer" text,
	"birth_date" date NOT NULL,
	"birth_time" time,
	"birth_place" text NOT NULL,
	"birth_place_lat" double precision NOT NULL,
	"birth_place_lng" double precision NOT NULL,
	"gender" text NOT NULL,
	"sun_sign" text NOT NULL,
	"moon_sign" text NOT NULL,
	"rising_sign" text NOT NULL,
	"relationship_status" text NOT NULL,
	"career_stage" text NOT NULL,
	"decision_style" text NOT NULL,
	"areas_of_interest" text[] NOT NULL,
	"goals_for_the_year" text[] NOT NULL,
	"content_preference" text NOT NULL,
	"belief_level" text NOT NULL,
	"personality_profile" text[] NOT NULL,
	"timezone" text NOT NULL,
	"notification_token" text,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transit" (
	"date" date PRIMARY KEY NOT NULL,
	"planets" jsonb NOT NULL,
	"aspects" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_insights" ADD CONSTRAINT "daily_insights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_providerAccountId_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_insights_user_id_date_idx" ON "daily_insights" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "profile_birth_place_lat_lng_idx" ON "profile" USING btree ("birth_place_lat","birth_place_lng");--> statement-breakpoint
CREATE INDEX "profile_notification_token_idx" ON "profile" USING btree ("notification_token");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");