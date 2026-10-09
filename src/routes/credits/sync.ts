import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import { inArray, sql } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { creditLedger, subscriptions } from "../../db/schema";
import { appEnv } from "../../env";
import { auth } from "../../lib/auth";
import {
    fetchPurchases,
    fetchSubscriptions,
    RemotePurchase,
    RemoteSubscription,
} from "../../modules/credits/revenuecatApi";
import { linkCustomer, replayParkedEvents } from "../../modules/credits/revenuecatApply";
import { ACCRUAL_INTERVAL_SECONDS, getCreditState, grantCredits } from "../../modules/credits/service";
import { CREDIT_FEATURES, SUBSCRIPTION_STATUSES } from "../../modules/credits/types";
import { sendInternalError } from "../../utils/errors";
import { errorResponseBuilder } from "../../utils/rateLimitResponse";
import { errorSchema } from "../../utils/zodResponse";

/**
 * Reconciling with RevenueCat on demand.
 *
 * The webhook is the durable path; this is the one that makes the sheet close on a
 * correct number. Three things can go wrong that only a pull can fix: a purchase made
 * before sign-in has no user to belong to, a delivery can be tens of seconds late, and
 * a delivery can be lost outright.
 *
 * It is safe to run alongside the webhook because both grant on the store's own
 * transaction id, so the same purchase processed twice lands once.
 */
const responseSchema = z.object({
    data: z.object({
        unlimited: z.boolean(),
        balance: z.number().int(),
        cap: z.number().int(),
        accrualIntervalSeconds: z.number().int(),
        nextCreditAt: z.string().nullable(),
        fullAt: z.string().nullable(),
        asOf: z.string(),
        costs: z.record(z.enum(CREDIT_FEATURES), z.number().int()),
        /** The ceiling on saved people. The same for a subscriber as for anyone else. */
        maxCompatibilityPeople: z.number().int(),
        /**
         * Which store products are credit packs, smallest first. The app shows only
         * these, so a yearly or lifetime subscription sitting in the same RevenueCat
         * offering can never be mistaken for a pack.
         */
        packs: z.array(z.object({ productId: z.string(), credits: z.number().int() })),
        subscription: z
            .object({
                status: z.enum(SUBSCRIPTION_STATUSES),
                productId: z.string(),
                expiresAt: z.string().nullable(),
                willRenew: z.boolean(),
            })
            .nullable(),
        /** What the reconcile actually did, for the log and for support. */
        replayedEvents: z.number().int(),
        /** False when RevenueCat could not be reached; the local replay still ran. */
        reconciled: z.boolean(),
    }),
});

interface RemoteView {
    subscriptions: RemoteSubscription[];
    purchases: RemotePurchase[];
}

/**
 * RevenueCat's own view of the customer.
 *
 * Read-only, so it starts before the local replay rather than after it — the two are
 * the slow halves of a sync, and neither needs the other to begin.
 */
async function fetchRemoteView(appUserId: string): Promise<RemoteView> {
    const [remoteSubscriptions, remotePurchases] = await Promise.all([
        fetchSubscriptions(appUserId),
        fetchPurchases(appUserId),
    ]);

    return { subscriptions: remoteSubscriptions, purchases: remotePurchases };
}

/**
 * Writes anything in RevenueCat's view newer than what we hold.
 *
 * Failure here is not fatal: the parked-event replay has already run, and the webhook
 * remains the durable path. Degrading to "we did what we could locally" is better than
 * a 500 on a screen the reader is waiting on.
 */
async function applyRemoteView(fastify: FastifyInstance, input: { userId: string; remote: RemoteView }) {
    for (const remote of input.remote.subscriptions) {
        if (remote.environment === "SANDBOX" && !appEnv.REVENUECAT_ALLOW_SANDBOX) {
            continue;
        }

        // The same ordering guard the webhook uses, so a pull cannot undo a newer event.
        await fastify.db
            .insert(subscriptions)
            .values({
                userId: input.userId,
                status: remote.status,
                expiresAt: remote.expiresAt,
                productId: remote.productId,
                store: remote.store,
                environment: remote.environment,
                willRenew: remote.willRenew,
                lastEventAt: remote.at,
                lastEventId: null,
            })
            .onConflictDoUpdate({
                target: subscriptions.userId,
                set: {
                    status: remote.status,
                    expiresAt: remote.expiresAt,
                    productId: remote.productId,
                    store: remote.store,
                    environment: remote.environment,
                    willRenew: remote.willRenew,
                    lastEventAt: remote.at,
                },
                where: sql`${subscriptions.lastEventAt} <= ${remote.at}`,
            });
    }

    const purchases = input.remote.purchases.filter(
        (purchase) => purchase.environment !== "SANDBOX" || appEnv.REVENUECAT_ALLOW_SANDBOX
    );

    if (purchases.length === 0) {
        return;
    }

    /**
     * RevenueCat answers with every pack the customer has ever bought, and granting each
     * one is a transaction of its own — so a reader with a long history paid for all of
     * it on every sync, one round trip after another. Asking once which of them are
     * already in the ledger leaves only the new ones, which after a purchase is one.
     *
     * Only a shortcut: the idempotency key still decides. A webhook landing between
     * this read and the grant below loses to it exactly as before.
     */
    const keys = purchases.map((purchase) => `purchase:${purchase.transactionId}`);

    const granted = await fastify.db
        .select({ key: creditLedger.idempotencyKey })
        .from(creditLedger)
        .where(inArray(creditLedger.idempotencyKey, keys));

    const already = new Set(granted.map((row) => row.key));

    for (const purchase of purchases) {
        const idempotencyKey = `purchase:${purchase.transactionId}`;

        if (already.has(idempotencyKey)) {
            continue;
        }

        /**
         * The same key the webhook would use. This is what makes the two paths safe to
         * run over the same purchase: whichever gets there first pays out, and the
         * other writes nothing.
         */
        await grantCredits(fastify.db, {
            userId: input.userId,
            amount: purchase.credits,
            reason: "purchase",
            idempotencyKey,
            metadata: { source: "sync", productId: purchase.productId },
        });
    }
}

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * The session the rate limiter already looked up, so the handler does not ask again.
 *
 * A WeakMap rather than a request decoration: it is this route's business alone, and
 * it lets go of the request with the request.
 */
const sessions = new WeakMap<FastifyRequest, Session>();

async function sessionOf(request: FastifyRequest): Promise<Session> {
    if (sessions.has(request)) {
        return sessions.get(request) ?? null;
    }

    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

    sessions.set(request, session);

    return session;
}

export default (async (fastify) => {
    await fastify.register(rateLimit, {
        global: false,
        keyGenerator: async (request) => {
            const session = await sessionOf(request);

            return session?.user?.id ?? request.ip;
        },
        errorResponseBuilder,
    });

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/sync",
        {
            /**
             * Never stands between a reader and a purchase: the store has already
             * charged by the time this runs, and the webhook grants the credits anyway —
             * a 429 here only delays them. The limit is for scripts holding a session,
             * which could otherwise turn this into a proxy for RevenueCat's project-wide
             * API quota; sixty confirmed purchases an hour is not a person.
             */
            config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
            schema: {
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await sessionOf(request);

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            const userId = session.user.id;

            try {
                /**
                 * Started first and awaited last: it is network-bound and touches nothing
                 * local, so it runs while the replay below does. Caught here rather than
                 * where it is awaited, so a failure cannot surface as an unhandled
                 * rejection while the replay is still going.
                 */
                const remote = fetchRemoteView(userId).catch((error: unknown) => {
                    request.log.warn({ err: error, userId }, "RevenueCat fetch failed, replay still applied");

                    return null;
                });

                /**
                 * The session is the only identity this route trusts. The SDK is logged in
                 * with the same id, so anything bought or restored on this device is
                 * already filed under it; an id taken from the body would let any reader
                 * claim someone else's RevenueCat customer, and with it their purchases.
                 */
                await linkCustomer(fastify.db, { appUserIds: [userId], userId });

                const replayedEvents = await replayParkedEvents(fastify.db, {
                    appUserIds: [userId],
                    userId,
                });

                /**
                 * Applied only after the replay, so a parked event and the pull of the same
                 * purchase still meet in the order they always have.
                 */
                const view = await remote;

                const reconciled =
                    view !== null &&
                    (await applyRemoteView(fastify, { userId, remote: view }).then(
                        () => true,
                        (error: unknown) => {
                            request.log.warn(
                                { err: error, userId },
                                "RevenueCat reconcile failed, replay still applied"
                            );

                            return false;
                        }
                    ));

                const state = await getCreditState(fastify.db, userId);

                return reply.status(200).send({
                    data: {
                        unlimited: state.unlimited,
                        balance: state.balance,
                        cap: state.cap,
                        accrualIntervalSeconds: ACCRUAL_INTERVAL_SECONDS,
                        nextCreditAt: state.nextCreditAt?.toISOString() ?? null,
                        fullAt: state.fullAt?.toISOString() ?? null,
                        asOf: new Date().toISOString(),
                        costs: state.costs,
                        maxCompatibilityPeople: state.maxCompatibilityPeople,
                        packs: state.packs,
                        subscription: state.subscription
                            ? {
                                  status: state.subscription.status as (typeof SUBSCRIPTION_STATUSES)[number],
                                  productId: state.subscription.productId,
                                  expiresAt: state.subscription.expiresAt?.toISOString() ?? null,
                                  willRenew: state.subscription.willRenew,
                              }
                            : null,
                        replayedEvents,
                        reconciled,
                    },
                });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to sync credits");
            }
        }
    );
}) satisfies FastifyPluginAsync;
