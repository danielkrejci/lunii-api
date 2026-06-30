CREATE TABLE IF NOT EXISTS "daily_insights" (
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"focus" text NOT NULL,
	"caution" text NOT NULL,
	"do" text NOT NULL,
	"avoid" text NOT NULL,
	"horoscope" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "timezone" DROP DEFAULT;