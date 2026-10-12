import { and, eq, or } from "drizzle-orm";

import { db } from "../../db";
import { account, revenuecatEvents } from "../../db/schema";
import { revokeAppleToken } from "../../lib/apple";
import { deleteUserImages } from "../profile/images";

/**
 * Sign in with Apple grants, revoked while the `account` rows still hold the tokens —
 * better-auth deletes them right after `beforeDelete`.
 */
async function revokeAppleTokens(userId: string) {
    const appleAccounts = await db
        .select({ accessToken: account.accessToken, refreshToken: account.refreshToken })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "apple")));

    for (const { accessToken, refreshToken } of appleAccounts) {
        if (refreshToken) {
            await revokeAppleToken(refreshToken, "refresh_token");
        } else if (accessToken) {
            await revokeAppleToken(accessToken, "access_token");
        }
    }
}

/**
 * Our copy of the RevenueCat webhooks. Its foreign key only nulls `user_id`, which would
 * leave the reader's id and every payload behind. RevenueCat itself is left alone: it
 * holds no more than a random id, and deleting there would take the revenue out of its
 * charts — an erasure request is handled in its dashboard.
 */
async function deleteRevenueCatEvents(userId: string) {
    await db
        .delete(revenuecatEvents)
        .where(or(eq(revenuecatEvents.userId, userId), eq(revenuecatEvents.appUserId, userId)));
}

/**
 * Everything of a reader's that the cascades on `user` do not reach. Run before the
 * user row goes, while the rows still say where everything is.
 *
 * Each part fails on its own and is only logged: what is left behind can be cleaned up
 * later, an account its owner asked to delete cannot be kept.
 */
export async function deleteUserData(userId: string) {
    const steps = {
        images: deleteUserImages(userId),
        appleTokens: revokeAppleTokens(userId),
        revenueCatEvents: deleteRevenueCatEvents(userId),
    };

    const results = await Promise.allSettled(Object.values(steps));

    Object.keys(steps).forEach((step, index) => {
        const result = results[index];

        if (result.status === "rejected") {
            console.error(`deleteUserData: ${step} failed`, result.reason);
        }
    });
}
