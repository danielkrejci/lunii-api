import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import { sql } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { subscriptions } from "../../db/schema";
import { env } from "../../env";
import { auth } from "../../lib/auth";
import { fetchPurchases, fetchSubscriptions } from "../../modules/credits/revenuecatApi";
import { linkCustomer, replayParkedEvents } from "../../modules/credits/revenuecatApply";
import { ACCRUAL_INTERVAL_SECONDS, getCreditState, grantCredits } from "../../modules/credits/service";
import { CREDIT_FEATURES, SUBSCRIPTION_STATUSES } from "../../modules/credits/types";
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

/**
 * Pulls RevenueCat's own view and writes anything newer than what we hold.
 *
 * Failure here is not fatal: the parked-event replay has already run, and the webhook
 * remains the durable path. Degrading to "we did what we could locally" is better than
 * a 500 on a screen the reader is waiting on.
 */
async function reconcile(fastify: FastifyInstance, input: { appUserId: string; userId: string }): Promise<boolean> {
    const [remoteSubscriptions, remotePurchases] = await Promise.all([
        fetchSubscriptions(input.appUserId),
        fetchPurchases(input.appUserId),
    ]);

    for (const remote of remoteSubscriptions) {
        if (remote.environment === "SANDBOX" && !env.REVENUECAT_ALLOW_SANDBOX) {
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

    for (const purchase of remotePurchases) {
        if (purchase.environment === "SANDBOX" && !env.REVENUECAT_ALLOW_SANDBOX) {
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
            idempotencyKey: `purchase:${purchase.transactionId}`,
            metadata: { source: "sync", productId: purchase.productId },
        });
    }

    return true;
}

export default (async (fastify) => {
    await fastify.register(rateLimit, {
        global: false,
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            return session?.user?.id ?? request.ip;
        },
        errorResponseBuilder: (_request, context) => {
            const totalSeconds = Math.floor((context?.ttl ?? 0) / 1000);

            return {
                statusCode: 429,
                error: {
                    hours: Math.floor(totalSeconds / 3600),
                    minutes: Math.floor((totalSeconds % 3600) / 60),
                    message: "You've reached the limit for now. Please try again later.",
                    silent: true,
                },
            };
        },
    });

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/sync",
        {
            /**
             * Generous enough for the two moments that matter — after a purchase and
             * after a restore — and mean enough that a client loop cannot turn this into
             * a proxy for RevenueCat's API.
             */
            config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
            schema: {
                body: z.object({
                    /**
                     * The id the SDK is configured with. Never a receipt and never an
                     * entitlement: everything that decides access is fetched server-side.
                     */
                    appUserId: z.string().min(1),
                }),
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            const userId = session.user.id;
            const { appUserId } = request.body;

            try {
                // Whoever the SDK says they are, they are this reader. Recorded first, so
                // the replay below can find anything parked under that id.
                await linkCustomer(fastify.db, { appUserIds: [appUserId, userId], userId });

                const replayedEvents = await replayParkedEvents(fastify.db, {
                    appUserIds: [appUserId, userId],
                    userId,
                });

                const reconciled = await reconcile(fastify, { appUserId, userId }).catch((error: unknown) => {
                    request.log.warn({ err: error, appUserId }, "RevenueCat reconcile failed, replay still applied");

                    return false;
                });

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
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to sync credits");

                return reply.status(500).send({
                    error: {
                        code: "error",
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
