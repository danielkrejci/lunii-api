CREATE TABLE "transit" (
	"date" timestamp PRIMARY KEY NOT NULL,
	"planets" jsonb NOT NULL,
	"aspects" jsonb NOT NULL
);
