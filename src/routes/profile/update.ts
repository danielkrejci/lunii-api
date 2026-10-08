import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { profile as profileTable } from "../../db/schema";
import { auth } from "../../lib/auth";
import { computeNatalChart, EphemerisError } from "../../modules/astro";
import { creditKeys } from "../../modules/credits/keys";
import { refundUnlock, spendCredits } from "../../modules/credits/service";
import { generatePersonalityProfile } from "../../modules/personality/generate";
import {
    clearWrittenFrom,
    diffProfile,
    findTodaysTexts,
    isDailyGenerating,
    rebaseCompatibility,
    restoreUpcomingDays,
    rewriteToday,
} from "../../modules/profile/update";
import { sendInternalError } from "../../utils/errors";
import { getLanguageByIso } from "../../utils/languageUtils";
import { Genders } from "../../utils/natalUtils";
import {
    AREAS_OF_INTEREST,
    BELIEF_LEVELS,
    CAREER_STAGES,
    CONTENT_PREFERENCES,
    DECISION_STYLES,
    RELATIONSHIP_STATUSES,
} from "../../utils/profileOptions";
import { errorResponseBuilder } from "../../utils/rateLimitResponse";
import { errorSchema, insufficientCreditsSchema } from "../../utils/zodResponse";
import { MIN_AGE } from "./add";

dayjs.extend(utc);

/**
 * Five edits a day of each field, subscriber or not — each one can rewrite every text of
 * the day. Per field rather than per reader: changing the language five times must not
 * use up the day's corrections to the birth date.
 */
const DAILY_EDITS = 5;

/** The four fields of the birth place travel together, so they count as one. */
const PLACE_FIELDS = new Set(["birthPlace", "birthPlaceLat", "birthPlaceLng", "country"]);

/**
 * Which field a request edits, for the rate limit's key. Every screen sends one field
 * (or the place); anything else is named by all its fields, so it gets a counter of its
 * own rather than borrowing one.
 */
function editedField(body: unknown): string {
    const keys = Object.keys(typeof body === "object" && body !== null ? body : {}).filter(
        (key) => key !== "requestId" && key !== "date"
    );

    const named = new Set(keys.map((key) => (PLACE_FIELDS.has(key) ? "birthPlace" : key)));

    return [...named].sort().join("+");
}

/** Thrown inside the transaction when another edit committed first. */
class ProfileChangedError extends Error {}

const bodySchema = z
    .object({
        /**
         * Minted by the app per edit. It names the purchase, so a retried tap is the
         * same edit and is charged once.
         */
        requestId: z.uuid(),
        /**
         * The reader's own today, as the app's clock shows it — the day the screens ask
         * for, and so the day whose texts are rewritten.
         */
        date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/u, "Date must be YYYY-MM-DD.")
            .refine((date) => Math.abs(dayjs.utc(date).diff(dayjs.utc().startOf("day"), "day")) <= 1, {
                message: "Date must be today.",
            }),

        name: z.string().trim().min(1, "Please enter your name.").max(60, "Name must be 60 characters or fewer."),
        gender: z.enum(Genders, { message: "Invalid gender." }),
        /** Wall clock, not an instant — see profile/add. */
        birthDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/u, "Birth date must be YYYY-MM-DD.")
            .refine((date) => dayjs(date).isSameOrBefore(dayjs().subtract(MIN_AGE, "year"), "day"), {
                message: `You must be at least ${MIN_AGE} years old.`,
            }),
        birthTime: z
            .string()
            .regex(/^\d{2}:\d{2}$/u, "Birth time must be HH:mm.")
            .nullable(),
        birthPlace: z.string().min(1, "Please enter your birth place."),
        birthPlaceLat: z.number().min(-90).max(90),
        birthPlaceLng: z.number().min(-180).max(180),
        country: z.string().min(1, "Please select your country."),
        language: z.string().refine((iso) => getLanguageByIso(iso) !== undefined, "Unsupported language."),
        relationshipStatus: z.enum(RELATIONSHIP_STATUSES),
        careerStage: z.enum(CAREER_STAGES),
        decisionStyle: z.enum(DECISION_STYLES),
        areasOfInterest: z
            .array(z.enum(AREAS_OF_INTEREST))
            .min(1, "Please select 1 to 3 options that best suit you.")
            .max(3, "You can select up to 3 areas of interest.")
            .refine((areas) => new Set(areas).size === areas.length, "Each area can be selected once."),
        contentPreference: z.enum(CONTENT_PREFERENCES),
        beliefLevel: z.enum(BELIEF_LEVELS),
    })
    // Every field but the two keys is optional: each screen sends only what it edits.
    .partial()
    .required({ requestId: true, date: true })
    .refine((body) => Object.keys(body).some((key) => key !== "requestId" && key !== "date"), "Nothing to update.")
    .refine(
        (body) => {
            const place = [body.birthPlace, body.birthPlaceLat, body.birthPlaceLng, body.country];

            return place.every((value) => value === undefined) || place.every((value) => value !== undefined);
        },
        { message: "Birth place, its coordinates and country are updated together.", path: ["birthPlace"] }
    );

export default (async (fastify) => {
    /**
     * `preHandler`, because the key reads the body: in the default `onRequest` it is not
     * parsed yet and every field would share one counter. It also means a request that
     * fails validation is not counted.
     */
    await fastify.register(rateLimit, {
        max: DAILY_EDITS,
        timeWindow: "1 day",
        hook: "preHandler",
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            return `${session?.user?.id ?? request.ip}:${editedField(request.body)}`;
        },
        errorResponseBuilder,
    });

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/update",
        {
            schema: {
                body: bodySchema,
                response: {
                    200: z.object({
                        data: z.object({
                            /**
                             * How far the edit reached, so the app knows what to refetch:
                             * `chart` rewrote scores and texts, `wording` only texts,
                             * `none` nothing that was written.
                             */
                            scope: z.enum(["chart", "wording", "none"]),
                        }),
                    }),
                    401: errorSchema,
                    402: insufficientCreditsSchema,
                    409: errorSchema,
                    500: errorSchema,
                    502: errorSchema,
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

            if (!session.profile) {
                return reply.status(409).send({
                    error: { code: "profile_required", message: "User must complete onboarding first." },
                });
            }

            const stored = session.profile;
            const userId = session.user.id;
            const { requestId, date, ...requested } = request.body;

            /**
             * Set once the edit is paid for and cleared once it is committed: anything
             * that fails in between — the model, the database — gives the credits back.
             */
            let refundUnsaved: (() => Promise<unknown>) | null = null;

            try {
                const { changed, scope } = diffProfile(stored, requested);

                // Saved with the values it already had: nothing to charge for or rewrite.
                if (Object.keys(changed).length === 0) {
                    return reply.status(200).send({ data: { scope: "none" as const } });
                }

                /**
                 * One rewrite at a time. The app holds the reader on the loading screen
                 * while today's horoscope is written, so a second edit landing now is a
                 * race, not a choice — and it would pay for a text the first one is
                 * still writing. Checked before anything is charged.
                 */
                if (scope !== "none" && (await isDailyGenerating(fastify.db, { userId, date }))) {
                    return reply.status(409).send({
                        error: {
                            code: "regeneration_in_progress",
                            message: "Today's reading is still being written. Try again in a moment.",
                        },
                    });
                }

                /**
                 * The new chart, computed before anything is charged so a place the
                 * ephemeris cannot handle costs nothing. The time zone comes from the
                 * birth place, as at signup, and it is also the reader's day — moving the
                 * place moves the day with it.
                 */
                const birthPlaceLat = changed.birthPlaceLat ?? stored.birthPlaceLat;
                const birthPlaceLng = changed.birthPlaceLng ?? stored.birthPlaceLng;
                // `null` is a real answer here (an unknown time), so `??` would not do.
                const birthTime =
                    changed.birthTime === undefined ? (stored.birthTime?.slice(0, 5) ?? null) : changed.birthTime;

                let derived: Partial<typeof profileTable.$inferInsert> = {};

                if (scope === "chart") {
                    const timezone = geoTz(birthPlaceLat, birthPlaceLng)[0] || "UTC";

                    try {
                        const { chart } = computeNatalChart({
                            birthDate: changed.birthDate ?? stored.birthDate,
                            birthTime,
                            birthPlaceLat,
                            birthPlaceLng,
                            timezone,
                        });

                        derived = {
                            timezone,
                            birthChart: chart,
                            // From the chart rather than a date table, so a cusp birthday
                            // gets the sign the rest of the app (chat, scoring) reads.
                            sunSign: chart.sun.sign,
                            moonSign: chart.moon.sign,
                            risingSign: chart.ascendant?.sign ?? null,
                        };
                    } catch (error: unknown) {
                        if (error instanceof EphemerisError) {
                            request.log.error({ err: error }, "Failed to compute birth chart");

                            return reply.status(409).send({
                                error: { code: "birth_chart_failed", message: "Birth chart could not be computed." },
                            });
                        }

                        throw error;
                    }
                }

                const next = { ...stored, ...changed, ...derived } as typeof stored;

                /**
                 * The purchase, keyed by the edit. A subscriber passes at a cost of zero;
                 * a second request with the same id finds it already bought and stops
                 * here, before it could rewrite anything twice.
                 */
                const resourceKey = creditKeys.profileUpdate(requestId);
                const spend = await spendCredits(fastify.db, { userId, feature: "profileUpdate", resourceKey });

                if (!spend.ok) {
                    return reply.status(402).send({
                        error: {
                            code: "insufficient_credits" as const,
                            message: "Not enough credits to update the profile.",
                            silent: true as const,
                            details: {
                                feature: "profileUpdate",
                                cost: spend.cost,
                                balance: spend.balance,
                                nextCreditAt: spend.nextCreditAt?.toISOString() ?? null,
                            },
                        },
                    });
                }

                if (spend.reason === "already_unlocked") {
                    return reply.status(409).send({
                        error: { code: "duplicate_request", message: "This update was already made." },
                    });
                }

                // Nothing was saved, so nothing is owed.
                const refund = () => {
                    refundUnsaved = null;

                    return refundUnlock(fastify.db, { userId, feature: "profileUpdate", resourceKey }).catch(
                        (error: unknown) =>
                            request.log.error({ err: error, userId }, "Failed to refund a profile update")
                    );
                };

                refundUnsaved = refund;

                /**
                 * The personality profile goes into every prompt, so it is written first
                 * and synchronously: the texts started after the commit read the new one
                 * and never wait for it. A failure keeps the old profile and the old data.
                 */
                if (scope !== "none") {
                    const personality = await generatePersonalityProfile(fastify, {
                        userId,
                        chart: next.birthChart,
                        hasBirthTime: next.birthTime !== null,
                        sunSign: next.sunSign,
                        risingSign: next.risingSign,
                        relationshipStatus: next.relationshipStatus,
                        careerStage: next.careerStage,
                        decisionStyle: next.decisionStyle,
                        areasOfInterest: next.areasOfInterest,
                        contentPreference: next.contentPreference,
                        beliefLevel: next.beliefLevel,
                        languageIso: next.language,
                        gender: next.gender,
                    });

                    if (!personality.personalityProfile) {
                        await refund();

                        return reply.status(502).send({
                            error: {
                                code: "personality_failed",
                                message: "Your profile could not be rewritten. Nothing was changed.",
                            },
                        });
                    }

                    derived.personalityProfile = personality.personalityProfile;
                    derived.personalityProfileInput = personality.personalityProfileInput;
                }

                // Read just before the write, so it is what this edit is about to replace.
                const texts = await findTodaysTexts(fastify.db, { userId, date });

                let updated: typeof stored;
                let upcomingDailyDates: string[] = [];

                try {
                    updated = await fastify.db.transaction(async (tx) => {
                        /**
                         * Locked and compared rather than written blind: two edits in
                         * flight at once would otherwise let the slower, older one commit
                         * last and put back what the newer one replaced. The lock is held
                         * for this transaction only — never across the model call above.
                         */
                        const [current] = await tx
                            .select({ updatedAt: profileTable.updatedAt })
                            .from(profileTable)
                            .where(eq(profileTable.id, stored.id))
                            .for("update");

                        if (current?.updatedAt.getTime() !== new Date(stored.updatedAt).getTime()) {
                            throw new ProfileChangedError();
                        }

                        const [row] = await tx
                            .update(profileTable)
                            .set({ ...changed, ...derived })
                            .where(eq(profileTable.id, stored.id))
                            .returning();

                        if (scope === "chart") {
                            await rebaseCompatibility(tx, { userId, readerChart: row.birthChart });
                        }

                        ({ upcomingDailyDates } = await clearWrittenFrom(tx, { userId, date, scope }));

                        return row;
                    });
                } catch (error: unknown) {
                    await refund();

                    if (error instanceof ProfileChangedError) {
                        return reply.status(409).send({
                            error: {
                                code: "profile_changed",
                                message: "Your profile was changed in the meantime. Please try again.",
                            },
                        });
                    }

                    throw error;
                }

                refundUnsaved = null;

                // After the commit: the rewrites read the profile they were started for.
                if (scope !== "none") {
                    await rewriteToday(fastify, { profile: updated, date, texts });
                    await restoreUpcomingDays(fastify.db, { profile: updated, dates: upcomingDailyDates });
                }

                return reply.status(200).send({ data: { scope } });
            } catch (error: unknown) {
                await refundUnsaved?.();

                return sendInternalError(request, reply, error, "Failed to update profile");
            }
        }
    );
}) satisfies FastifyPluginAsync;
