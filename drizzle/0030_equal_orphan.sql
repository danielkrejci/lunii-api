CREATE TABLE "chat_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"next_order" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message_order" integer NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"error_code" text,
	"client_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_ready_has_content" CHECK (("chat_messages"."status" <> 'ready' or length(btrim("chat_messages"."content")) > 0)),
	CONSTRAINT "chat_messages_user_is_ready" CHECK (("chat_messages"."role" <> 'user' or "chat_messages"."status" = 'ready'))
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_conversations_user_last_message_idx" ON "chat_conversations" USING btree ("user_id","last_message_at" DESC NULLS LAST) WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_conversation_order_idx" ON "chat_messages" USING btree ("conversation_id","message_order");--> statement-breakpoint
CREATE INDEX "chat_messages_streaming_idx" ON "chat_messages" USING btree ("updated_at") WHERE status = 'streaming';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_user_client_id_idx" ON "chat_messages" USING btree ("user_id","client_id") WHERE client_id is not null;