import { timingSafeEqual } from "node:crypto";

import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { env } from "../../env";
import { RevenuecatEvent } from "../../modules/credits/revenuecat";
import { applyEvent, markEvent, recordEvent, resolveUser } from "../../modules/credits/revenuecatApply";
import { errorSchema } from "../../utils/zodResponse";

/**
 * Loose on purpose.
 *
 * RevenueCat adds fields to this payload, and a strict schema would turn every
 * addition into a 400 and a retry storm. Only what the handler actually reads is
 * required; the rest is carried through to `payload` and stored whole, which is the
 * only place a dispute can be reconstructed from later.
 */
const bodySchema = z.object({
    api_version: z.string().optional(),
    event: z.looseObject({
        id: z.string().min(1),
        type: z.string().min(1),
        app_user_id: z.string().min(1),
    }),
});

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch. */
function matches(given: string, expected: string): boolean {
    const a = Buffer.from(given);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether this delivery carries the shared secret.
 *
 * Both the bare secret and `Bearer <secret>` are accepted, because RevenueCat sends
 * whatever string is typed into its Authorization field and either form is a reasonable
 * thing to have typed. Rejecting one of them fails closed and silently — a 401 is
 * refused before the event is recorded, so the events table stays empty and there is
 * nothing to look at while wondering why no credits arrived.
 */
function isAuthorized(header: string | undefined): boolean {
    if (!header) {
        return false;
    }

    const secret = env.REVENUECAT_WEBHOOK_SECRET;
    const bare = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;

    return matches(header, secret) || matches(bare, secret);
}

export default (async (fastify) => {
    /**
     * Never rate limited. RevenueCat retries anything that is not a 2xx with backoff,
     * so throttling a renewal spike would compound it into a queue that never drains.
     */
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/revenuecat",
        {
            schema: {
                body: bodySchema,
                response: {
                    200: z.object({ received: z.literal(true), duplicate: z.boolean() }),
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            if (!isAuthorized(request.headers.authorization)) {
                request.log.warn("Rejected a RevenueCat webhook with a bad Authorization header");

                return reply.status(401).send({
                    error: { code: "unauthorized", message: "Invalid webhook signature." },
                });
            }

            const event = request.body.event as RevenuecatEvent;

            /**
             * Written down before anything is decided. A delivery that does not come
             * back from here has already been dealt with, and answering 200 to it is
             * the whole of the idempotency guarantee.
             */
            const { isNew } = await recordEvent(fastify.db, { event, payload: request.body });

            if (!isNew) {
                return reply.status(200).send({ received: true, duplicate: true });
            }

            const userId = await resolveUser(fastify.db, event);

            /**
             * A purchase that arrived before the app finished signing in. Parked rather
             * than dropped: `POST /api/credits/sync` replays it the moment the client
             * says who it is, and answering 200 stops RevenueCat retrying something no
             * amount of retrying will resolve.
             */
            if (!userId) {
                await markEvent(fastify.db, { eventId: event.id, userId: null, status: "unmapped" });
                request.log.warn({ appUserId: event.app_user_id, type: event.type }, "RevenueCat event has no user");

                return reply.status(200).send({ received: true, duplicate: false });
            }

            try {
                const status = await applyEvent(fastify.db, { event, userId });

                await markEvent(fastify.db, { eventId: event.id, userId, status });

                return reply.status(200).send({ received: true, duplicate: false });
            } catch (error: unknown) {
                /**
                 * The one case worth a 500. The delivery is on record as `failed`, which
                 * is what lets RevenueCat's retry through `recordEvent` a second time —
                 * so this is a failure that can actually be recovered from rather than
                 * one swallowed as a duplicate.
                 */
                const message = error instanceof Error ? error.message : String(error);

                await markEvent(fastify.db, { eventId: event.id, userId, status: "failed", error: message });
                request.log.error({ err: error, eventId: event.id }, "Failed to apply a RevenueCat event");

                return reply.status(500).send({
                    error: { code: "error", message: "Failed to apply the event." },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
