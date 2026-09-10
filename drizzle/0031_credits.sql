CREATE TABLE "credit_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer NOT NULL,
	"balance_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_balance_non_negative" CHECK ("credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"feature" text,
	"resource_key" text,
	"idempotency_key" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_delta_non_zero" CHECK ("credit_ledger"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "credit_unlocks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"resource_key" text NOT NULL,
	"credits_spent" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_unlocks_spent_non_negative" CHECK ("credit_unlocks"."credits_spent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "revenuecat_customers" (
	"app_user_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenuecat_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"app_user_id" text NOT NULL,
	"user_id" text,
	"product_id" text,
	"environment" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"product_id" text NOT NULL,
	"store" text NOT NULL,
	"environment" text NOT NULL,
	"will_renew" boolean DEFAULT true NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "charge_key" text;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_unlocks" ADD CONSTRAINT "credit_unlocks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenuecat_customers" ADD CONSTRAINT "revenuecat_customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenuecat_events" ADD CONSTRAINT "revenuecat_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_idx" ON "credit_ledger" USING btree ("idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_unlocks_user_feature_resource_idx" ON "credit_unlocks" USING btree ("user_id","feature","resource_key");--> statement-breakpoint
CREATE INDEX "revenuecat_customers_user_idx" ON "revenuecat_customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "revenuecat_events_unmapped_idx" ON "revenuecat_events" USING btree ("app_user_id","event_at") WHERE status = 'unmapped';--> statement-breakpoint
CREATE INDEX "subscriptions_expires_at_idx" ON "subscriptions" USING btree ("expires_at") WHERE status in ('active', 'canceled', 'billing_issue');