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
import { DailyOverviewResponse } from "../modules/compatibilityPeople/ai";
import { CompatibilityResult, DailyCompatibilityResult } from "../modules/compatibilityPeople/types";
import { DailyInsightContent, GenerationStatus } from "../modules/insights";
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
    type: text("type").$type<"dailyInsight" | "compatibilityPeople" | "personalityProfile">().notNull(),
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
        content: jsonb("content").$type<DailyOverviewResponse>(),

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
        goalsForTheYear: text("goals_for_the_year").array().notNull(),
        contentPreference: text("content_preference").notNull(),
        beliefLevel: text("belief_level").notNull(),
        personalityProfile: text("personality_profile").notNull(),
        personalityProfileInput: text("personality_profile_input").notNull(),
        timezone: text("timezone").notNull(),
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
