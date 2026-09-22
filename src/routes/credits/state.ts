import { fromNodeHeaders } from "better-auth/node";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { auth } from "../../lib/auth";
import { ACCRUAL_INTERVAL_SECONDS, getCreditState } from "../../modules/credits/service";
import { CREDIT_FEATURES, SUBSCRIPTION_STATUSES } from "../../modules/credits/types";
import { errorSchema } from "../../utils/zodResponse";

/**
 * The wallet, and everything needed to keep showing it between reads.
 *
 * `asOf` is not decoration. The balance regenerates on a timer, so the client counts
 * down locally rather than polling — and a device whose clock is an hour fast would
 * otherwise "earn" credits the server then refuses. Working in server time costs one
 * field and removes the whole class of bug.
 *
 * `costs` travels with it so no price is ever compiled into the app.
 */
const responseSchema = z.object({
    data: z.object({
        /** An active subscription. Every other field below is display-only when true. */
        unlimited: z.boolean(),
        balance: z.number().int(),
        /** What regeneration fills to. A bought pack can leave `balance` above it. */
        cap: z.number().int(),
        accrualIntervalSeconds: z.number().int(),
        /** ISO. Null when full, or unlimited — the client stops its countdown. */
        nextCreditAt: z.string().nullable(),
        fullAt: z.string().nullable(),
        /** The server's clock, so the client can correct for the device's. */
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
    }),
});

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/state",
        {
            schema: {
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });

            if (!session) {
                return reply.status(401).send({
                    error: {
                        code: "unauthorized",
                        message: "User must be logged in to access this resource.",
                    },
                });
            }

            /**
             * No `profile` requirement, unlike every generating route. Someone part-way
             * through onboarding may legitimately ask what they have — and the account
             * row is created on first sight either way.
             */
            try {
                const state = await getCreditState(fastify.db, session.user.id);

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
                    },
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to read credit state");

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
