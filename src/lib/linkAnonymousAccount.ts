import { and, eq, notInArray } from "drizzle-orm";

import { db } from "../db";
import { compatibilityPeople, dailyInsights, profile, user } from "../db/schema";

/**
 * Moves every row owned by an anonymous user over to the account they just
 * signed in with.
 *
 * Called from the `anonymous()` plugin's `onLinkAccount` hook. The plugin
 * deletes the anonymous user immediately afterwards, and every `user_id`
 * foreign key is `ON DELETE CASCADE`, so anything left behind here is lost —
 * all reassignment has to happen inside this call.
 *
 * Two of the target tables have uniqueness constraints that the merge can
 * violate when the user signs into an account that already holds data (a
 * returning user rather than a fresh sign-up):
 *
 * - `profile.user_id` is UNIQUE
 * - `daily_insights` is UNIQUE on (user_id, date)
 *
 * In both cases the existing account wins and the anonymous copy is dropped.
 * `compatibility_people_scores` follows its parent row via `person_id`, so it
 * needs no explicit handling.
 */
export async function linkAnonymousAccount(anonymousUserId: string, newUserId: string) {
    if (anonymousUserId === newUserId) {
        return;
    }

    await db.transaction(async (tx) => {
        // compatibility people — no uniqueness on user_id, so a plain reassign
        await tx
            .update(compatibilityPeople)
            .set({ userId: newUserId })
            .where(eq(compatibilityPeople.userId, anonymousUserId));

        // daily insights — skip dates the target account already has
        const takenDates = await tx
            .select({ date: dailyInsights.date })
            .from(dailyInsights)
            .where(eq(dailyInsights.userId, newUserId));

        await tx
            .update(dailyInsights)
            .set({ userId: newUserId })
            .where(
                takenDates.length > 0
                    ? and(
                          eq(dailyInsights.userId, anonymousUserId),
                          notInArray(
                              dailyInsights.date,
                              takenDates.map((row) => row.date)
                          )
                      )
                    : eq(dailyInsights.userId, anonymousUserId)
            );

        // drop the anonymous duplicates that lost the date conflict
        await tx.delete(dailyInsights).where(eq(dailyInsights.userId, anonymousUserId));

        // profile — one per user, so either move it across or discard it
        const [anonymousProfile] = await tx.select().from(profile).where(eq(profile.userId, anonymousUserId)).limit(1);

        if (!anonymousProfile) {
            return;
        }

        const [existingProfile] = await tx
            .select({ id: profile.id, name: profile.name })
            .from(profile)
            .where(eq(profile.userId, newUserId))
            .limit(1);

        if (existingProfile) {
            // Keep the real account's profile, but carry over the push token —
            // it belongs to the device doing the sign-in, not to the old profile.
            if (anonymousProfile.notificationToken) {
                await tx
                    .update(profile)
                    .set({ notificationToken: anonymousProfile.notificationToken })
                    .where(eq(profile.id, existingProfile.id));
            }

            await tx.delete(profile).where(eq(profile.id, anonymousProfile.id));
        } else {
            await tx.update(profile).set({ userId: newUserId }).where(eq(profile.id, anonymousProfile.id));
        }

        // Apple only returns the user's name on the very first authorization, so
        // returning users land here with an empty `user.name`. Backfill it from
        // whichever profile the account ended up with.
        const profileName = existingProfile?.name ?? anonymousProfile.name;
        const [targetUser] = await tx.select({ name: user.name }).from(user).where(eq(user.id, newUserId)).limit(1);

        if (targetUser && !targetUser.name.trim() && profileName) {
            await tx.update(user).set({ name: profileName }).where(eq(user.id, newUserId));
        }
    });
}
