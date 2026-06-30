ALTER TABLE "profile" ALTER COLUMN "birth_date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "transit" ALTER COLUMN "date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "timezone" text NOT NULL;