import { expo } from "@better-auth/expo";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, customSession } from "better-auth/plugins";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { profile } from "../db/schema";
import { serializeDrizzleData } from "../utils/serializeDrizzleData";

const config = {
    user: {
        deleteUser: {
            enabled: true,
        },
    },
    plugins: [
        expo(),
        anonymous(),
        customSession(async ({ user: sessionUser, session }) => {
            const profileData = await db
                .select()
                .from(schema.profile)
                .where(eq(profile.userId, sessionUser.id))
                .orderBy(desc(profile.createdAt))
                .limit(1);

            if (profileData.length === 0) {
                return {
                    user: sessionUser,
                    session,
                    profile: null,
                };
            }

            return {
                user: sessionUser,
                session,
                profile: serializeDrizzleData(profileData[0]),
            };
        }),
    ],
    trustedOrigins: ["luniiapp://"],
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: schema,
    }),

    session: {
        expiresIn: 60 * 60 * 24 * 400,
        updateAge: 60 * 60 * 24,
    },
} satisfies BetterAuthOptions;

export const auth = betterAuth(config);

export type AuthType = typeof auth;
