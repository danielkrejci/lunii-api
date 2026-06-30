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

export const dailyInsights = pgTable(
    "daily_insights",
    {
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        date: date("date", { mode: "string" }).notNull(),
        focus: text("focus").array().notNull(),
        caution: text("caution").array().notNull(),
        do: text("do").notNull(),
        avoid: text("avoid").notNull(),
        horoscope: text("horoscope").notNull(),
        moonInsight: text("moonInsight").notNull().default(""),
        scoreLove: numeric("score_love").$type<number>().notNull().default(0),
        scoreCareer: numeric("score_career").$type<number>().notNull().default(0),
        scoreHealth: numeric("score_health").$type<number>().notNull().default(0),
        scoreMood: numeric("score_mood").$type<number>().notNull().default(0),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [uniqueIndex("daily_insights_user_id_date_idx").on(table.userId, table.date)]
);

export const transit = pgTable("transit", {
    date: date("date", { mode: "string" }).primaryKey(),
    planets: jsonb("planets").notNull(),
    aspects: jsonb("aspects").notNull(),
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
        gender: text("gender").notNull(),
        sunSign: text("sun_sign").notNull(),
        moonSign: text("moon_sign").notNull(),
        risingSign: text("rising_sign").notNull(),
        relationshipStatus: text("relationship_status").notNull(),
        careerStage: text("career_stage").notNull(),
        decisionStyle: text("decision_style").notNull(),
        areasOfInterest: text("areas_of_interest").array().notNull(),
        goalsForTheYear: text("goals_for_the_year").array().notNull(),
        contentPreference: text("content_preference").notNull(),
        beliefLevel: text("belief_level").notNull(),
        personalityProfile: text("personality_profile").notNull(),
        timezone: text("timezone").notNull(),
        notificationToken: text("notification_token"),
        country: text("country").notNull(),
        language: text("language").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
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
        .$onUpdate(() => /* @__PURE__ */ new Date())
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
            .$onUpdate(() => /* @__PURE__ */ new Date())
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
            .$onUpdate(() => /* @__PURE__ */ new Date())
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
            .$onUpdate(() => /* @__PURE__ */ new Date())
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
