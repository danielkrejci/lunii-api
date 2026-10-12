import { expo } from "@better-auth/expo";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, customSession } from "better-auth/plugins";
import { desc, eq } from "drizzle-orm";

import { db } from "../db";
import * as schema from "../db/schema";
import { account, profile } from "../db/schema";
import { appEnv } from "../env/appEnv";
import { deleteUserData } from "../modules/account/delete";
import { generateAppleClientSecret } from "./apple";

const config = {
    user: {
        changeEmail: {
            enabled: true,
            updateEmailWithoutVerification: true,
        },
        deleteUser: {
            enabled: true,
            /**
             * The cascades take every row; this is the rest — photos in R2, the Apple
             * grant, our copy of the RevenueCat webhooks.
             */
            beforeDelete: async (user) => {
                await deleteUserData(user.id);
            },
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
        anonymous({
            /**
             * Never delete the anonymous account on link.
             *
             * The app only ever upgrades through `linkSocial`, which keeps the same
             * `user.id`, so better-auth's cleanup does not fire today — it is guarded on
             * the new session belonging to a *different* user. But credits, unlocks and
             * a subscription all hang off `user.id` and all cascade, so the day someone
             * adds a `signIn.social()` while an anonymous session is live, the deletion
             * would take paid-for balance with it. The row is cheap; the incident is not.
             */
            disableDeleteAnonymousUser: true,
        }),
        customSession(async ({ user: sessionUser, session }) => {
            try {
                const profileData = await db
                    .select()
                    .from(schema.profile)
                    .where(eq(profile.userId, sessionUser.id))
                    .orderBy(desc(profile.createdAt));

                const accountsData = await db
                    .select({
                        id: account.id,
                        accountId: account.id,
                        providerId: account.providerId,
                        createdAt: account.createdAt,
                        updatedAt: account.updatedAt,
                    })
                    .from(account)
                    .where(eq(account.userId, sessionUser.id));

                if (profileData.length === 0) {
                    return {
                        user: sessionUser,
                        session,
                        profile: null,
                        accounts: accountsData,
                    };
                }

                return {
                    user: sessionUser,
                    session,
                    profile: profileData.at(0),
                    accounts: accountsData,
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
    baseURL: appEnv.BETTER_AUTH_URL,
    socialProviders: {
        google: {
            clientId: appEnv.GOOGLE_CLIENT_ID,
            clientSecret: appEnv.GOOGLE_CLIENT_SECRET,
        },
        apple: async () => ({
            clientId: appEnv.APPLE_CLIENT_ID,
            clientSecret: await generateAppleClientSecret(),
            appBundleIdentifier: appEnv.APPLE_APP_BUNDLE_IDENTIFIER,
        }),
    },
    session: {
        expiresIn: 60 * 60 * 24 * 400,
        updateAge: 60 * 60 * 24,
        cookieCache: {
            enabled: true,
            maxAge: 60 * 5,
        },
        /**
         * Off: no "signed in recently" check for sensitive endpoints (deleting the account).
         * Sessions live for 400 days and keep their `createdAt`, so the default 24h would
         * refuse nearly everyone — and there is no password to prove it again with, only
         * Apple, Google or an anonymous session. The app's confirmation guards it instead.
         */
        freshAge: 0,
    },
    rateLimit: {
        window: 10,
        max: 100,
    },
} satisfies BetterAuthOptions;

export const auth = betterAuth(config);

export type AuthType = typeof auth;
