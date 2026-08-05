import { expo } from "@better-auth/expo";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, customSession } from "better-auth/plugins";
import { desc, eq } from "drizzle-orm";
import { importPKCS8, SignJWT } from "jose";

import { db } from "../db";
import * as schema from "../db/schema";
import { account, profile } from "../db/schema";
import { env } from "../env";
import { backfillScoresForUser } from "../modules/dailyScore/service";
import { serializeDrizzleData } from "../utils/drizzleUtils";

export async function generateAppleClientSecret() {
    const key = await importPKCS8(env.APPLE_PRIVATE_KEY, "ES256");

    const now = Math.floor(Date.now() / 1000);

    return await new SignJWT({})
        .setProtectedHeader({
            alg: "ES256",
            kid: env.APPLE_KEY_ID,
        })
        .setIssuer(env.APPLE_TEAM_ID)
        .setSubject(env.APPLE_CLIENT_ID)
        .setAudience("https://appleid.apple.com")
        .setIssuedAt(now)
        .setExpirationTime(now + 180 * 24 * 60 * 60)
        .sign(key);
}

const config = {
    user: {
        changeEmail: {
            enabled: true,
            updateEmailWithoutVerification: true,
        },
        deleteUser: {
            enabled: true,
        },
    },
    account: {
        accountLinking: {
            enabled: true,
            allowDifferentEmails: true,
        },
    },
    plugins: [
        expo(),
        anonymous(),
        customSession(async ({ user: sessionUser, session }) => {
            try {
                const profileData = await db
                    .select()
                    .from(schema.profile)
                    .where(eq(profile.userId, sessionUser.id))
                    .orderBy(desc(profile.createdAt))
                    .limit(1);

                console.log("profileData", profileData);

                if (profileData.length === 0) {
                    return {
                        user: sessionUser,
                        session,
                        profile: null,
                        accounts: [],
                    };
                }

                const accounts = await db
                    .select({
                        id: account.id,
                        accountId: account.id,
                        providerId: account.providerId,
                        createdAt: account.createdAt,
                        updatedAt: account.updatedAt,
                    })
                    .from(account)
                    .where(eq(account.userId, sessionUser.id));

                return {
                    user: sessionUser,
                    session,
                    profile: serializeDrizzleData(profileData[0]),
                    accounts,
                };
            } catch (error) {
                console.error("customSession: failed to load profile", error);
                return {
                    user: sessionUser,
                    session,
                    profile: null,
                    accounts: [],
                };
            }
        }),
    ],
    trustedOrigins: [
        "lunii://",
        "exp://",
        "https://appleid.apple.com",
        "https://api-dev.getlunii.com",
        "https://api.getlunii.com",
    ],
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: schema,
    }),
    baseURL: env.BETTER_AUTH_URL,
    socialProviders: {
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
        apple: async () => ({
            clientId: env.APPLE_CLIENT_ID,
            clientSecret: await generateAppleClientSecret(),
            appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
        }),
    },
    session: {
        expiresIn: 60 * 60 * 24 * 400,
        updateAge: 60 * 60 * 24,
        cookieCache: {
            enabled: true,
            maxAge: 60 * 5,
        },
    },
    databaseHooks: {
        session: {
            create: {
                /**
                 * Fill the user's score window on sign-in. Scores only — no AI — so this
                 * is pure CPU over ~15 days and costs nothing per login.
                 *
                 * Fire and forget on purpose: a backfill failure must never block or fail
                 * a sign-in.
                 */
                after: async (session) => {
                    const [userProfile] = await db
                        .select({ birthChart: profile.birthChart, birthTime: profile.birthTime })
                        .from(profile)
                        .where(eq(profile.userId, session.userId))
                        .limit(1);

                    // No profile yet means onboarding is unfinished; nothing to score against.
                    if (!userProfile) {
                        return;
                    }

                    void backfillScoresForUser(db, {
                        userId: session.userId,
                        profile: userProfile,
                    }).catch((error) => {
                        console.error("backfillScoresForUser failed", error);
                    });
                },
            },
        },
    },
    rateLimit: {
        window: 10,
        max: 100,
    },
} satisfies BetterAuthOptions;

export const auth = betterAuth(config);

export type AuthType = typeof auth;
