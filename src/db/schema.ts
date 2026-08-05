import { relations } from "drizzle-orm";
import {
    boolean,
    date,
    doublePrecision,
    index,
    jsonb,
    numeric,
    pgTable,
    text,
    time,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";

import { NatalChart } from "../modules/astro";
import { DailyOverviewResponse } from "../modules/compatibilityPeople/ai";
import { CompatibilityResult, DailyCompatibilityResult } from "../modules/compatibilityPeople/types";
import { RawScores, ScoreBreakdown } from "../modules/dailyScore/types";
import { DailyInsight, DailyPlanetInsight } from "../modules/insights";
import { Gender, Relationship, TransitAspects, TransitPlanets, ZodiacSign } from "../utils/natalUtils";

export const compatibilityPeopleScores = pgTable(
    "compatibility_people_scores",
    {
        date: date("date", { mode: "string" }).notNull(),
        personId: text("person_id")
            .notNull()
            .references(() => compatibilityPeople.id, { onDelete: "cascade" }),
        score: numeric("score", { mode: "number" }).notNull(),
        compatibility: jsonb("compatibility").$type<DailyCompatibilityResult>().notNull(),
        overview: text("overview"),
        positiveOverview: jsonb("positive_overview").$type<DailyOverviewResponse["positiveOverview"]>(),
        negativeOverview: jsonb("negative_overview").$type<DailyOverviewResponse["negativeOverview"]>(),
        insights: jsonb("insights").$type<DailyOverviewResponse["insights"]>(),
        practicalAdvice: text("practical_advice"),
        rawInput: text("raw_input"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [uniqueIndex("compatibility_people_scores_person_date_idx").on(table.personId, table.date)]
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
        overview: jsonb("overview").$type<DailyInsight["overview"]>(),
        moon: jsonb("moon").$type<DailyInsight["moon"]>(),
        loveScore: numeric("love_score", { mode: "number" }).notNull(),
        loveInsight: jsonb("love_insight").$type<DailyInsight["insights"]["love"]>(),
        careerScore: numeric("career_score", { mode: "number" }).notNull(),
        careerInsight: jsonb("career_insight").$type<DailyInsight["insights"]["career"]>(),
        healthScore: numeric("health_score", { mode: "number" }).notNull(),
        healthInsight: jsonb("health_insight").$type<DailyInsight["insights"]["health"]>(),
        moodScore: numeric("mood_score", { mode: "number" }).notNull(),
        moodInsight: jsonb("mood_insight").$type<DailyInsight["insights"]["mood"]>(),
        overallScore: numeric("overall_score", { mode: "number" }).notNull(),
        overallInsight: jsonb("overall_insight").$type<DailyInsight["insights"]["overall"]>(),
        opportunity: jsonb("opportunity").$type<DailyInsight["opportunity"]>(),
        watchOut: jsonb("watch_out").$type<DailyInsight["watchOut"]>(),
        deepInsight: text("deep_insight"),
        /**
         * Per-body weight with the AI's interpretation. Stored rather than recomputed
         * because the text is part of it, and regenerating text is neither free nor
         * deterministic.
         */
        planets: jsonb("planets").$type<DailyPlanetInsight[]>(),
        /**
         * Pre-squash sums. Without these a score cannot be explained later: the
         * 0-100 value alone says nothing about how it got there.
         */
        rawScores: jsonb("raw_scores").$type<RawScores>(),
        /** 0-1. How much aspect weight the chart produced. Metadata — never part of the score. */
        confidence: numeric("confidence", { mode: "number" }),
        /** Strongest contributions per area plus the narrative top list, for debugging and the prompt. */
        scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>(),
        /**
         * Which engine produced this row. Recomputing an old row after rules.ts moved
         * on legitimately gives a different number; without this there is no way to
         * tell that apart from a bug.
         */
        engineVersion: text("engine_version"),
        calibrationVersion: text("calibration_version"),
        rawResponse: text("raw_response"),
        rawInput: text("raw_input"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => [uniqueIndex("daily_insights_user_id_date_idx").on(table.userId, table.date)]
);

export const transit = pgTable("transit", {
    date: date("date", { mode: "string" }).primaryKey(),
    planets: jsonb("planets").$type<TransitPlanets>().notNull(),
    aspects: jsonb("aspects").$type<TransitAspects>().notNull(),
});

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
