import { relations, sql } from "drizzle-orm";
import {
    boolean,
    check,
    date,
    doublePrecision,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    primaryKey,
    text,
    time,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";

import { NatalChart } from "../modules/astro";
import { ChatMessageStatus, ChatRole } from "../modules/chat/types";
import { CompatibilityInsightContent } from "../modules/compatibilityPeople/ai";
import { CompatibilityResult, DailyCompatibilityResult } from "../modules/compatibilityPeople/types";
import { CreditFeature, CreditLedgerReason, RevenuecatEventStatus, SubscriptionStatus } from "../modules/credits/types";
import { DailyInsightContent, GenerationStatus } from "../modules/insights";
import { PlanetInsightContent } from "../modules/insights/planets";
import { MoonInsightContent } from "../modules/moon/ai";
import { MoonVariant } from "../modules/moon/today";
import { Gender, Relationship, TransitAspects, TransitPlanets, ZodiacSign } from "../utils/natalUtils";

export const aiGenerations = pgTable("ai_generations", {
    id: text()
        .primaryKey()
        .notNull()
        .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    type: text("type")
        .$type<
            "dailyInsight" | "moonInsight" | "planetInsight" | "compatibilityPeople" | "personalityProfile" | "chat"
        >()
        .notNull(),
    status: text("status").$type<"success" | "error">().notNull(),
    error: text("error"),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    inputTokens: numeric("input_tokens", { mode: "number" }).notNull(),
    outputTokens: numeric("output_tokens", { mode: "number" }).notNull(),
    total_tokens: numeric("total_tokens", { mode: "number" }).notNull(),
    latencyMs: numeric("latency_ms", { mode: "number" }).notNull(),
    cost: numeric("cost", { mode: "number" }).notNull(),
});

export const chatConversations = pgTable(
    "chat_conversations",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        /** Derived from the first message. Never null — a thread is created with one. */
        title: text("title").notNull(),

        /**
         * What the list is ordered by. Separate from `updated_at`, which moves for
         * reasons the reader never sees — a title rewrite, a soft delete — and would
         * reshuffle the list without a message having been sent.
         */
        lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),

        /**
         * The next `message_order` to hand out. Claimed with a single
         * `set next_order = next_order + n returning next_order`, which locks the row
         * for the duration — so two messages sent at once can never share a position.
         */
        nextOrder: integer("next_order").default(1).notNull(),

        /**
         * Set instead of deleting. Deleting a thread is something the reader does to
         * their own screen, not a decision about retention, and the row is what the
         * `ai_generations` audit was written against. Every read filters on `is null`.
         */
        deletedAt: timestamp("deleted_at"),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        // The list query, exactly: one user's live threads, newest first.
        index("chat_conversations_user_last_message_idx")
            .on(table.userId, table.lastMessageAt.desc())
            .where(sql`deleted_at is null`),
    ]
);

export const chatMessages = pgTable(
    "chat_messages",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        conversationId: text("conversation_id")
            .notNull()
            .references(() => chatConversations.id, { onDelete: "cascade" }),

        /**
         * Denormalised from the conversation so every ownership check and every page of
         * history is one index lookup rather than a join. It is also what keeps the
         * check honest: a query that forgets the reader is visibly wrong where it is
         * written, rather than quietly wrong inside a join condition.
         */
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        /**
         * Total order within the thread, and the pagination cursor.
         *
         * `created_at` cannot be either: two rows written in the same millisecond have
         * no defined order between them, and a cursor on a timestamp needs a tiebreaker
         * regardless.
         *
         * The column is `message_order` rather than `order` because ORDER is reserved
         * in Postgres — Drizzle quotes it, but every hand-written query and every psql
         * session would have to remember to as well.
         */
        order: integer("message_order").notNull(),

        role: text("role").$type<ChatRole>().notNull(),

        /**
         * Whole on insert for a reader's message. An assistant's accumulates: partial
         * while the model is writing, complete once `ready`, and whatever arrived before
         * the failure when `failed` — a half-written answer is still worth showing.
         */
        content: text("content").notNull().default(""),

        /**
         * `streaming` is this run's claim on the row. As in `daily_insights`,
         * `updated_at` carries the claim and doubles as the timeout for a run that died
         * mid-flight — so nothing outside that lifecycle may write to this row, and
         * `$onUpdate` must stay off.
         */
        status: text("status").$type<ChatMessageStatus>().default("ready").notNull(),

        /** A code, not a sentence: the client owns the wording. Null unless failed. */
        errorCode: text("error_code"),

        /**
         * The client's own id for the send. A retried POST — a flaky network, a
         * backgrounded app — carries the same one and attaches to the message already
         * written instead of asking a second time. Null on assistant rows.
         */
        clientId: text("client_id"),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        // The order, the pagination query and the guarantee of no duplicate position.
        uniqueIndex("chat_messages_conversation_order_idx").on(table.conversationId, table.order),

        // The stuck-run sweeper, and the "is anything already running for me" guard.
        index("chat_messages_streaming_idx")
            .on(table.updatedAt)
            .where(sql`status = 'streaming'`),

        /**
         * One row per client attempt, scoped to the reader rather than to the thread:
         * the send that most needs protecting is the one that opens a conversation,
         * and at that moment there is no `conversation_id` to be unique within. Ids are
         * UUIDs, so nothing is lost by widening the scope. Partial, because only a
         * reader's message carries one.
         */
        uniqueIndex("chat_messages_user_client_id_idx")
            .on(table.userId, table.clientId)
            .where(sql`client_id is not null`),

        /**
         * The same contract every generated table here keeps: `ready` means whole. The
         * insight tables spell it as "content is not null"; text that is present but
         * empty is the same lie, so this one measures it.
         */
        check(
            "chat_messages_ready_has_content",
            sql`(${table.status} <> 'ready' or length(btrim(${table.content})) > 0)`
        ),

        // A reader's message is never generated, so it can never be mid-flight.
        check("chat_messages_user_is_ready", sql`(${table.role} <> 'user' or ${table.status} = 'ready')`),
    ]
);

export const creditAccounts = pgTable(
    "credit_accounts",
    {
        userId: text("user_id")
            .primaryKey()
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        /**
         * Credits banked as of `balance_updated_at`, not as of now. What a reader
         * actually has is this plus the whole hours since — see `balance_updated_at`.
         *
         * May exceed `CREDIT_CAP`: a bought pack is not regeneration and must not be
         * eaten by it. Never negative — a clawback on a refunded pack clamps at zero
         * rather than putting a reader in debt, and the ledger records what was in fact
         * applied.
         */
        balance: integer("balance").notNull(),

        /**
         * The accrual anchor: the instant from which whole hours have not yet been
         * credited. NOT "when this row was last touched", and the distinction is the
         * whole design.
         *
         * Accrual advances it by `floor(elapsed_hours)` hours and no further, so the
         * part-hour survives every read and every spend. Setting it to `now()` — the
         * obvious thing — would push the next credit back to a full hour every time the
         * app was opened, and a reader who spends at half past would silently lose
         * thirty minutes.
         *
         * The alternative was an hourly cron topping everyone up. Rejected: there is no
         * distributed lock here (see `createStuckGenerationsJob`), so a second instance
         * would double-grant; a missed run silently costs everyone an hour; and it
         * writes every row in the table to express something that is a subtraction of
         * two timestamps.
         *
         * Written only ever from SQL `now()` arithmetic, never from a JS `Date`.
         */
        balanceUpdatedAt: timestamp("balance_updated_at", { withTimezone: true }).defaultNow().notNull(),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [check("credit_accounts_balance_non_negative", sql`${table.balance} >= 0`)]
);

export const creditLedger = pgTable(
    "credit_ledger",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        /** Signed. Negative is a spend or a clawback, positive a grant or a refund. */
        delta: integer("delta").notNull(),

        /** What this row left behind, so a dispute is answered by reading, not replaying. */
        balanceAfter: integer("balance_after").notNull(),

        reason: text("reason").$type<CreditLedgerReason>().notNull(),

        /**
         * What it was for. Null on a purchase or a grant.
         *
         * Denormalised rather than a foreign key to `credit_unlocks`: a refund deletes
         * the unlock, and an append-only ledger must not have rows quietly cascade out
         * from under it.
         */
        feature: text("feature").$type<CreditFeature>(),
        resourceKey: text("resource_key"),

        /**
         * The thing that must not happen twice, named. A store transaction id for a
         * purchase, `refund:<transaction id>` for a clawback.
         *
         * Null for a spend — a spend is made idempotent by the unlock row instead, in
         * the same transaction.
         */
        idempotencyKey: text("idempotency_key"),

        /** The payload the decision was made from, when there was one. */
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        // The statement a reader — or support — asks for: my history, newest first.
        index("credit_ledger_user_created_idx").on(table.userId, table.createdAt.desc()),

        // The guarantee that a webhook delivered twice grants once.
        uniqueIndex("credit_ledger_idempotency_idx")
            .on(table.idempotencyKey)
            .where(sql`idempotency_key is not null`),

        // A zero-delta row records nothing and could only ever be a bug leaking through.
        check("credit_ledger_delta_non_zero", sql`${table.delta} <> 0`),
    ]
);

export const creditUnlocks = pgTable(
    "credit_unlocks",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        feature: text("feature").$type<CreditFeature>().notNull(),

        /**
         * What was bought, canonically: a date for the day-shaped features,
         * `<personId>:<date>` for a compatibility reading, the client's own send id for
         * a chat message. Built in one place — `modules/credits/keys.ts` — so the string
         * a debit writes and the string a check reads can never drift.
         */
        resourceKey: text("resource_key").notNull(),

        /**
         * What it cost when it was bought, so a refund gives back the price paid rather
         * than today's. Zero for the rows the backfill grandfathered in, which is what
         * stops a refund handing back credits nobody ever spent.
         */
        creditsSpent: integer("credits_spent").notNull(),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        /**
         * The whole charging model in one constraint: pay once per user, per feature,
         * per resource. It is also the mutual exclusion — the debit inserts here before
         * the money moves, so two taps on the same horoscope block on each other and
         * exactly one of them pays.
         *
         * A refund deletes the row rather than flagging it, which keeps this a plain
         * unique index and keeps `on conflict` honest. The ledger is the audit trail;
         * this table is only ever the answer to "is it open".
         */
        uniqueIndex("credit_unlocks_user_feature_resource_idx").on(table.userId, table.feature, table.resourceKey),
        check("credit_unlocks_spent_non_negative", sql`${table.creditsSpent} >= 0`),
    ]
);

export const subscriptions = pgTable(
    "subscriptions",
    {
        userId: text("user_id")
            .primaryKey()
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        status: text("status").$type<SubscriptionStatus>().notNull(),

        /**
         * The only thing that actually ends entitlement. `canceled` means auto-renew is
         * off, which is a fact about the next charge and not about today.
         */
        expiresAt: timestamp("expires_at", { withTimezone: true }),

        productId: text("product_id").notNull(),
        store: text("store").notNull(),
        environment: text("environment").$type<"PRODUCTION" | "SANDBOX">().notNull(),

        /** Whether the store intends to charge again. Display only — never gates access. */
        willRenew: boolean("will_renew").default(true).notNull(),

        /**
         * The event this row was last written from. RevenueCat does not promise order,
         * so an EXPIRATION delivered after the RENEWAL that superseded it must not be
         * allowed to close a live subscription — every write is guarded on being newer.
         */
        lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
        lastEventId: text("last_event_id"),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        // Any "who is entitled right now" question, and the renewal sweep.
        index("subscriptions_expires_at_idx")
            .on(table.expiresAt)
            .where(sql`status in ('active', 'canceled', 'billing_issue')`),
    ]
);

export const revenuecatCustomers = pgTable(
    "revenuecat_customers",
    {
        /**
         * RevenueCat's id for the buyer, which is not necessarily ours. The client calls
         * `Purchases.logIn(user.id)`, but a purchase made before that call lands under an
         * anonymous `$RCAnonymousID:...`, and RevenueCat keeps both as aliases of one
         * customer. Every alias gets a row, all pointing at one user.
         */
        appUserId: text("app_user_id").primaryKey().notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [index("revenuecat_customers_user_idx").on(table.userId)]
);

export const revenuecatEvents = pgTable(
    "revenuecat_events",
    {
        /**
         * RevenueCat's own event id, as the primary key rather than as an indexed column.
         * The insert IS the idempotency check: a row that does not come back is a
         * delivery that has already been dealt with.
         */
        id: text("id").primaryKey().notNull(),

        type: text("type").notNull(),
        appUserId: text("app_user_id").notNull(),

        /**
         * Null when the buyer could not be mapped to a user yet — a purchase that arrived
         * before the app finished signing in. Parked rather than dropped, and replayed by
         * `POST /api/credits/sync` once the client says who it is.
         */
        userId: text("user_id").references(() => user.id, { onDelete: "set null" }),

        productId: text("product_id"),
        environment: text("environment").notNull(),

        /** RevenueCat's `event_timestamp_ms`, which is what orders events — not arrival. */
        eventAt: timestamp("event_at", { withTimezone: true }).notNull(),

        status: text("status").$type<RevenuecatEventStatus>().notNull(),
        error: text("error"),

        /** The whole body. The only place a dispute can be reconstructed from. */
        payload: jsonb("payload").notNull(),

        receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
        processedAt: timestamp("processed_at", { withTimezone: true }),
    },
    (table) => [
        // The replay query: everything still waiting for an owner, oldest first.
        index("revenuecat_events_unmapped_idx")
            .on(table.appUserId, table.eventAt)
            .where(sql`status = 'unmapped'`),
    ]
);

export const compatibilityPeopleScores = pgTable(
    "compatibility_people_scores",
    {
        date: date("date", { mode: "string" }).notNull(),
        personId: text("person_id")
            .notNull()
            .references(() => compatibilityPeople.id, { onDelete: "cascade" }),
        score: numeric("score", { mode: "number" }).notNull(),
        compatibility: jsonb("compatibility").$type<DailyCompatibilityResult>().notNull(),

        /** The whole AI-written half. Null until generated, complete once it is. */
        content: jsonb("content").$type<CompatibilityInsightContent>(),

        /**
         * Lifecycle of the generation. `updated_at` carries the time of its last change
         * and doubles as the timeout for a run that died mid-flight — so nothing outside
         * that lifecycle may write to this row, and `$onUpdate` must stay off.
         */
        status: text("status").$type<GenerationStatus>().default("absent").notNull(),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("compatibility_people_scores_person_date_idx").on(table.personId, table.date),
        check(
            "compatibility_people_scores_ready_has_content",
            sql`((${table.status} = 'ready' and ${table.content} is not null) or (${table.status} <> 'ready' and ${table.content} is null))`
        ),
    ]
);

export const compatibilityPeople = pgTable(
    "compatibility_people",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        gender: text("gender").$type<Gender>().notNull(),
        relationship: text("relationship").$type<Relationship>().notNull(),
        birthDate: date("birth_date", { mode: "string" }).notNull(),
        birthTime: time("birth_time"),
        birthPlace: text("birth_place"),
        birthPlaceLat: doublePrecision("birth_place_lat"),
        birthPlaceLng: doublePrecision("birth_place_lng"),
        timezone: text("timezone"),
        image: text("image"),
        sunSign: text("sun_sign").$type<ZodiacSign>().notNull(),
        moonSign: text("moon_sign").$type<ZodiacSign>(),
        risingSign: text("rising_sign").$type<ZodiacSign>(),
        birthChart: jsonb("birth_chart").$type<NatalChart>().notNull(),
        baseScore: numeric("base_score", { mode: "number" }).notNull(),
        baseCompatibility: jsonb("base_compatibility").$type<CompatibilityResult>().notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [index("compatibility_people_user_id_idx").on(table.userId)]
);

export const dailyInsights = pgTable(
    "daily_insights",
    {
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        date: date("date", { mode: "string" }).notNull(),
        status: text("status").$type<GenerationStatus>().default("absent").notNull(),

        loveScore: numeric("love_score", { mode: "number" }).notNull(),
        careerScore: numeric("career_score", { mode: "number" }).notNull(),
        healthScore: numeric("health_score", { mode: "number" }).notNull(),
        moodScore: numeric("mood_score", { mode: "number" }).notNull(),
        overallScore: numeric("overall_score", { mode: "number" }).notNull(),

        content: jsonb("content").$type<DailyInsightContent>(),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("daily_insights_user_id_date_idx").on(table.userId, table.date),
        check(
            "daily_insights_ready_has_content",
            sql`((${table.status} = 'ready' and ${table.content} is not null) or (${table.status} <> 'ready' and ${table.content} is null))`
        ),
    ]
);

export const moonInsights = pgTable(
    "moon_insights",
    {
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        date: date("date", { mode: "string" }).notNull(),

        /**
         * Lifecycle of the generation, and deliberately its own — the daily horoscope
         * runs on `daily_insights.updated_at` as an ownership token, and a second
         * generation claiming that same row would invalidate a run already in flight.
         *
         * As there, `updated_at` doubles as the timeout for a run that died mid-flight,
         * so nothing outside that lifecycle may write to this row and `$onUpdate` must
         * stay off.
         */
        status: text("status").$type<GenerationStatus>().default("absent").notNull(),

        /**
         * Which prompt wrote the text. Stored rather than derived from today's phase:
         * the copy is written once, and a hero layout that disagrees with the words
         * under it is worse than one that is a few hours stale.
         */
        variant: text("variant").$type<MoonVariant>().notNull(),

        /** The whole AI-written half. Null until generated, complete once it is. */
        content: jsonb("content").$type<MoonInsightContent>(),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("moon_insights_user_id_date_idx").on(table.userId, table.date),
        check(
            "moon_insights_ready_has_content",
            sql`((${table.status} = 'ready' and ${table.content} is not null) or (${table.status} <> 'ready' and ${table.content} is null))`
        ),
    ]
);

export const planetInsights = pgTable(
    "planet_insights",
    {
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        date: date("date", { mode: "string" }).notNull(),

        /**
         * Lifecycle of the generation, and deliberately its own — the horoscope runs on
         * `daily_insights.updated_at` as an ownership token, and a panel generation
         * claiming that same row would invalidate a run already in flight.
         *
         * As there, `updated_at` doubles as the timeout for a run that died mid-flight,
         * so nothing outside that lifecycle may write to this row and `$onUpdate` must
         * stay off.
         */
        status: text("status").$type<GenerationStatus>().default("absent").notNull(),

        /** The whole AI-written half. Null until generated, complete once it is. */
        content: jsonb("content").$type<PlanetInsightContent>(),

        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("planet_insights_user_id_date_idx").on(table.userId, table.date),
        check(
            "planet_insights_ready_has_content",
            sql`((${table.status} = 'ready' and ${table.content} is not null) or (${table.status} <> 'ready' and ${table.content} is null))`
        ),
    ]
);

export const transit = pgTable(
    "transit",
    {
        date: date("date", { mode: "string" }).notNull(),
        /**
         * Offset in minutes of the zone this row was computed for, so half- and
         * quarter-hour zones fit too (India +330, Nepal +345, Chatham +765).
         *
         * A date is a different span of time in every zone, and the Moon moves half a
         * degree an hour — one row per date would put a user in Auckland and one in
         * Honolulu on the same planetary positions half a day apart.
         */
        utcOffset: integer("utc_offset").notNull(),
        planets: jsonb("planets").$type<TransitPlanets>().notNull(),
        aspects: jsonb("aspects").$type<TransitAspects>().notNull(),
    },
    (table) => [primaryKey({ columns: [table.date, table.utcOffset] })]
);

/**
 * A logical pass of pre-generation over one target date.
 *
 * Exists to be unique. Two schedulers, a redeployed process or a retried tick must not
 * be able to start the same pass twice and pay Gemini twice for the same work, and the
 * constraint below is what makes that impossible rather than unlikely.
 *
 * It deliberately says nothing about whether any given day got written — that lives on
 * the content row, and a second place claiming to know it would be a second thing to
 * keep in step.
 */
export const generationRuns = pgTable(
    "generation_runs",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        /** The day being written, not the day the writing happens. */
        targetDate: date("target_date", { mode: "string" }).notNull(),
        /**
         * Which kind of text this pass writes. Separate runs per type because they do not
         * start together: the Moon and the planets read the horoscope for continuity, so
         * they can only be submitted once it exists.
         */
        contentType: text("content_type")
            .$type<"dailyInsight" | "moonInsight" | "planetInsight" | "compatibilityDetail">()
            .notNull(),
        /** 1 is the batch pass, 2 the interactive sweep that closes the gap before the day. */
        pass: integer("pass").notNull(),
        status: text("status").$type<"running" | "completed" | "failed">().default("running").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        completedAt: timestamp("completed_at"),
    },
    (table) => [uniqueIndex("generation_runs_date_type_pass_idx").on(table.targetDate, table.contentType, table.pass)]
);

/**
 * One submitted Gemini batch inside a run.
 *
 * Separate from the run because a single pass will not stay a single batch: the work
 * splits by timezone, by region or simply by size long before 50,000 readers, and a
 * unique key that allowed only one job per day would have to be torn out the first time
 * that happened.
 */
export const generationBatches = pgTable(
    "generation_batches",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        runId: text("run_id")
            .notNull()
            .references(() => generationRuns.id, { onDelete: "cascade" }),
        /** Whatever the run was split on — a UTC offset, a region, a shard number. */
        shardKey: text("shard_key").notNull(),
        /** Gemini's own name for the job, and how it is polled and cancelled. */
        providerBatchId: text("provider_batch_id"),
        status: text("status")
            .$type<"submitted" | "completed" | "failed" | "cancelled">()
            .default("submitted")
            .notNull(),
        itemCount: integer("item_count").notNull(),
        submittedAt: timestamp("submitted_at").defaultNow().notNull(),
        completedAt: timestamp("completed_at"),
    },
    (table) => [uniqueIndex("generation_batches_run_shard_idx").on(table.runId, table.shardKey)]
);

export const profile = pgTable(
    "profile",
    {
        id: text()
            .primaryKey()
            .notNull()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" })
            .unique(),
        name: text("name").notNull(),
        referrer: text("referrer"),
        birthDate: date("birth_date", { mode: "string" }).notNull(),
        birthTime: time("birth_time"),
        birthPlace: text("birth_place").notNull(),
        birthPlaceLat: doublePrecision("birth_place_lat").notNull(),
        birthPlaceLng: doublePrecision("birth_place_lng").notNull(),
        gender: text("gender").$type<Gender>().notNull(),
        sunSign: text("sun_sign").$type<ZodiacSign>().notNull(),
        moonSign: text("moon_sign").$type<ZodiacSign>().notNull(),
        // Nullable: an Ascendant without a birth time would be a fabrication.
        risingSign: text("rising_sign").$type<ZodiacSign>(),
        relationshipStatus: text("relationship_status").notNull(),
        careerStage: text("career_stage").notNull(),
        decisionStyle: text("decision_style").notNull(),
        areasOfInterest: text("areas_of_interest").array().notNull(),
        contentPreference: text("content_preference").notNull(),
        beliefLevel: text("belief_level").notNull(),
        personalityProfile: text("personality_profile").notNull(),
        personalityProfileInput: text("personality_profile_input").notNull(),
        timezone: text("timezone").notNull(),
        /**
         * When the app was last opened, to the hour.
         *
         * Pre-generation is bought speculatively — the content is written before anyone
         * asks for it and paid for whether or not they come back — so it is offered only
         * to people who have been around recently. Kept coarse on purpose: this is a
         * cohort filter, not analytics, and writing it precisely would mean a row update
         * on every request.
         */
        lastActiveAt: timestamp("last_active_at"),
        notificationToken: text("notification_token"),
        country: text("country").notNull(),
        language: text("language").notNull(),
        birthChart: jsonb("birth_chart").$type<NatalChart>().notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("profile_birth_place_lat_lng_idx").on(table.birthPlaceLat, table.birthPlaceLng),
        index("profile_notification_token_idx").on(table.notificationToken),
        // The scheduler sweeps by recency every hour; without this it is a full scan.
        index("profile_last_active_at_idx").on(table.lastActiveAt),
    ]
);

export const user = pgTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull(),
    isAnonymous: boolean("is_anonymous").default(false),
});

export const session = pgTable(
    "session",
    {
        id: text("id").primaryKey(),
        expiresAt: timestamp("expires_at").notNull(),
        token: text("token").notNull().unique(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .$onUpdate(() => new Date())
            .notNull(),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
    },
    (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = pgTable(
    "account",
    {
        id: text("id").primaryKey(),
        accountId: text("account_id").notNull(),
        providerId: text("provider_id").notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),
        accessTokenExpiresAt: timestamp("access_token_expires_at"),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [
        index("account_userId_idx").on(table.userId),
        uniqueIndex("account_provider_providerAccountId_idx").on(table.providerId, table.accountId),
    ]
);

export const verification = pgTable(
    "verification",
    {
        id: text("id").primaryKey(),
        identifier: text("identifier").notNull(),
        value: text("value").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const profileRelations = relations(profile, ({ one }) => ({
    user: one(user, {
        fields: [profile.userId],
        references: [user.id],
    }),
}));

export const userRelations = relations(user, ({ one, many }) => ({
    sessions: many(session),
    accounts: many(account),
    profile: one(profile, {
        fields: [user.id],
        references: [profile.userId],
    }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
    user: one(user, {
        fields: [session.userId],
        references: [user.id],
    }),
}));

export const accountRelations = relations(account, ({ one }) => ({
    user: one(user, {
        fields: [account.userId],
        references: [user.id],
    }),
}));
