ALTER TABLE "profile" RENAME COLUMN "zodiac_sign" TO "sun_sign";--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "moon_sign" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "rising_sign" text NOT NULL DEFAULT '';