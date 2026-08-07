CREATE TABLE "ai_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"input_tokens" numeric NOT NULL,
	"output_tokens" numeric NOT NULL,
	"total_tokens" numeric NOT NULL,
	"latency_ms" numeric NOT NULL,
	"cost" numeric NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;