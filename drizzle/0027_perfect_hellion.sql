/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'transit'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

ALTER TABLE "transit" ADD COLUMN "utc_offset" integer NOT NULL;
ALTER TABLE "transit" DROP CONSTRAINT "transit_pkey";--> statement-breakpoint
ALTER TABLE "transit" ADD CONSTRAINT "transit_pkey" PRIMARY KEY("date","utc_offset");--> statement-breakpoint