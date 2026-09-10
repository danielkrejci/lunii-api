import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { revenuecatCustomers, revenuecatEvents, subscriptions } from "../../db/schema";
import { env } from "../../env";
import {
    candidateAppUserIds,
    eventEnvironment,
    eventTimestamp,
    interpretEvent,
    isAnonymousAppUserId,
    RevenuecatEvent,
} from "./revenuecat";
import { grantCredits } from "./service";
import { RevenuecatEventStatus } from "./types";

type Db = FastifyInstance["db"];

/**
 * Doing what `interpretEvent` decided.
 *
 * Split from the reading so the half that is easy to get wrong can be tested without a
 * database, and so the webhook and `/api/credits/sync` share one path to entitlement
 * rather than two that drift.
 */

/**
 * Which of our users this buyer is, if we know yet.
 *
 * Tried most specific first: the id the client set, then anything RevenueCat has
 * aliased to it. A hit on an alias backfills the mapping, so the next event resolves
 * on the first try.
 */
export async function resolveUser(db: Db, event: RevenuecatEvent): Promise<string | null> {
    const candidates = candidateAppUserIds(event);

    for (const appUserId of candidates) {
        if (isAnonymousAppUserId(appUserId)) {
            continue;
        }

        const [mapped] = await db
            .select({ userId: revenuecatCustomers.userId })
            .from(revenuecatCustomers)
            .where(eq(revenuecatCustomers.appUserId, appUserId))
            .limit(1);

        if (mapped) {
            await linkCustomer(db, { appUserIds: candidates, userId: mapped.userId });

            return mapped.userId;
        }
    }

    /**
     * The happy path, and the reason it is last: the client calls
     * `Purchases.logIn(user.id)`, so `app_user_id` is normally our own id already. The
     * mapping table only matters for a purchase made before that call.
     */
    for (const appUserId of candidates) {
        if (isAnonymousAppUserId(appUserId)) {
            continue;
        }

        const exists = await db.query.user.findFirst({
            columns: { id: true },
            where: (table, { eq: equals }) => equals(table.id, appUserId),
        });

        if (exists) {
            await linkCustomer(db, { appUserIds: candidates, userId: exists.id });

            return exists.id;
        }
    }

    return null;
}

/** Records every alias as belonging to one user, so a later event resolves at once. */
export async function linkCustomer(db: Db, input: { appUserIds: string[]; userId: string }): Promise<void> {
    const rows = input.appUserIds
        .filter((appUserId) => !isAnonymousAppUserId(appUserId))
        .map((appUserId) => ({ appUserId, userId: input.userId }));

    if (rows.length === 0) {
        return;
    }

    await db.insert(revenuecatCustomers).values(rows).onConflictDoNothing();
}

/**
 * Applies one event to one user.
 *
 * Idempotent in both directions: a grant is keyed on the store transaction, and a
 * subscription write is refused if an event newer than this one has already landed.
 */
export async function applyEvent(
    db: Db,
    input: { event: RevenuecatEvent; userId: string }
): Promise<RevenuecatEventStatus> {
    const { event, userId } = input;
    const intent = interpretEvent(event, { allowSandbox: env.REVENUECAT_ALLOW_SANDBOX });

    switch (intent.kind) {
        case "ignore":
            return "ignored";

        case "grant": {
            await grantCredits(db, {
                userId,
                amount: intent.amount,
                reason: intent.amount >= 0 ? "purchase" : "purchase_refund",
                idempotencyKey: intent.idempotencyKey,
                metadata: { eventId: event.id, type: event.type, productId: intent.productId },
            });

            return "processed";
        }

        case "subscription": {
            const at = eventTimestamp(event);

            /**
             * The ordering guard. RevenueCat does not promise delivery order, and an
             * EXPIRATION that arrives after the RENEWAL which superseded it would
             * otherwise close a subscription that is running.
             */
            await db
                .insert(subscriptions)
                .values({
                    userId,
                    status: intent.status,
                    expiresAt: intent.expiresAt,
                    productId: intent.productId,
                    store: intent.store,
                    environment: intent.environment,
                    willRenew: intent.willRenew,
                    lastEventAt: at,
                    lastEventId: event.id,
                })
                .onConflictDoUpdate({
                    target: subscriptions.userId,
                    set: {
                        status: intent.status,
                        expiresAt: intent.expiresAt,
                        productId: intent.productId,
                        store: intent.store,
                        environment: intent.environment,
                        willRenew: intent.willRenew,
                        lastEventAt: at,
                        lastEventId: event.id,
                    },
                    where: sql`${subscriptions.lastEventAt} <= ${at}`,
                });

            return "processed";
        }

        case "transfer": {
            /**
             * The purchase moved to a different App User ID — a restore on a fresh
             * install, which for an anonymous reader is the only way back to what they
             * bought. Re-point every alias, and move the subscription with them.
             */
            await linkCustomer(db, { appUserIds: [...intent.from, ...intent.to], userId });

            return "processed";
        }
    }
}

/**
 * Everything parked for these ids, replayed oldest first.
 *
 * A purchase made before the app finished signing in has no user to belong to, so it
 * is stored rather than dropped. This is what collects it once the client says who it
 * is — through `applyEvent`, so entitlement has exactly one code path.
 */
export async function replayParkedEvents(db: Db, input: { appUserIds: string[]; userId: string }): Promise<number> {
    if (input.appUserIds.length === 0) {
        return 0;
    }

    const parked = await db
        .select({ id: revenuecatEvents.id, payload: revenuecatEvents.payload })
        .from(revenuecatEvents)
        .where(and(eq(revenuecatEvents.status, "unmapped"), inArray(revenuecatEvents.appUserId, input.appUserIds)))
        .orderBy(asc(revenuecatEvents.eventAt));

    let replayed = 0;

    for (const row of parked) {
        const event = unwrapEvent(row.payload);
        const status = await applyEvent(db, { event, userId: input.userId });

        await db
            .update(revenuecatEvents)
            .set({ userId: input.userId, status, processedAt: sql`now()`, error: null })
            .where(eq(revenuecatEvents.id, row.id));

        replayed += 1;
    }

    return replayed;
}

/**
 * The event out of a stored payload.
 *
 * `payload` holds the whole request body — `{ api_version, event }` — because that is
 * what a dispute has to be reconstructed from, and half a body is no use for that. So
 * every reader has to unwrap, and doing it in one place is what stops a replay quietly
 * interpreting the envelope as the event and deciding there is nothing to do.
 */
function unwrapEvent(payload: unknown): RevenuecatEvent {
    const body = payload as { event?: RevenuecatEvent };

    return body?.event ?? (payload as RevenuecatEvent);
}

/** Where a delivery is written down, and the check that it has not been seen before. */
export async function recordEvent(
    db: Db,
    input: { event: RevenuecatEvent; payload: unknown }
): Promise<{ isNew: boolean }> {
    const { event } = input;

    /**
     * The insert IS the idempotency check. `do update ... where status = 'failed'` is
     * what lets RevenueCat's retry of a delivery we failed to process through, while
     * still refusing one we already handled.
     */
    const [row] = await db
        .insert(revenuecatEvents)
        .values({
            id: event.id,
            type: event.type,
            appUserId: event.app_user_id,
            productId: event.product_id ?? null,
            environment: eventEnvironment(event),
            eventAt: eventTimestamp(event),
            status: "unmapped",
            payload: input.payload as object,
        })
        .onConflictDoUpdate({
            target: revenuecatEvents.id,
            set: { receivedAt: sql`now()` },
            where: eq(revenuecatEvents.status, "failed"),
        })
        .returning({ id: revenuecatEvents.id });

    return { isNew: row !== undefined };
}

/** Closes out a delivery, whatever became of it. */
export async function markEvent(
    db: Db,
    input: { eventId: string; userId: string | null; status: RevenuecatEventStatus; error?: string }
): Promise<void> {
    await db
        .update(revenuecatEvents)
        .set({
            userId: input.userId,
            status: input.status,
            error: input.error ?? null,
            processedAt: sql`now()`,
        })
        .where(eq(revenuecatEvents.id, input.eventId));
}
