import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { computeNatalChart, EphemerisError } from "../../../modules/astro";
import { calculateCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { BASE_NORMALIZER } from "../../../modules/compatibilityPeople/calibration";
import { scoreDay } from "../../../modules/compatibilityPeople/daily";
import { startCompatibilityGeneration } from "../../../modules/compatibilityPeople/generateDetail";
import { normalizeScore } from "../../../modules/compatibilityPeople/normalizer";
import { creditKeys } from "../../../modules/credits/keys";
import { checkAccess, getCreditState, revokeUnlocks, spendCredits } from "../../../modules/credits/service";
import { getOrCreateTransits } from "../../../modules/dailyScore/service";
import { sendInternalError } from "../../../utils/errors";
import { Genders, getSunSign, Relationships, ZodiacSign } from "../../../utils/natalUtils";
import { errorResponseBuilder } from "../../../utils/rateLimitResponse";
import { insufficientCreditsSchema } from "../../../utils/zodResponse";
import { MIN_AGE } from "../../profile/add";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const errorBody = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

export default (async (fastify) => {
    /**
     * Keyed by person, like the detail's generate route — and for the same reason in
     * `preHandler`: the person comes from the body, which `onRequest` has not parsed yet.
     */
    await fastify.register(rateLimit, {
        global: false,
        hook: "preHandler",
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
            const personId = (request.body as { id?: string } | undefined)?.id;

            return `${session?.user?.id ?? request.ip}:${personId ?? ""}`;
        },
        errorResponseBuilder,
    });

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/update",
        {
            /**
             * A change of birth data rewrites today's reading straight away, so every
             * update can cost a generation. Counts every update, a renamed person too —
             * the limit cannot see what changed before the handler runs. Five a day, the
             * same budget as editing your own profile, leaves room for correcting a slip
             * straight after an edit without hitting the wall.
             */
            config: { rateLimit: { max: 5, timeWindow: "1 day" } },
            schema: {
                body: z.object({
                    id: z.string(),
                    name: z.string().min(1, "Name is required").max(60, "Name must be at most 60 characters long"),
                    relationship: z.enum(Relationships, { message: "Relationship is invalid" }),
                    gender: z.enum(Genders, { message: "Gender is invalid" }),
                    /** Wall clock, not an instant — see profile/add for why. */
                    birthDate: z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Birth date must be YYYY-MM-DD.")
                        .refine((date) => dayjs(date).isSameOrBefore(dayjs().subtract(MIN_AGE, "year"), "day"), {
                            message: `You must be at least ${MIN_AGE} years old`,
                        }),
                    birthTime: z
                        .string()
                        .regex(/^\d{2}:\d{2}$/u, "Birth time must be HH:mm.")
                        .nullable(),
                    birthPlace: z.string().nullable(),
                    birthPlaceLat: z.number().min(-90).max(90).nullable(),
                    birthPlaceLng: z.number().min(-180).max(180).nullable(),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            compatibilityPersonId: z.string(),
                        }),
                    }),
                    401: errorBody,
                    402: insufficientCreditsSchema,
                    404: errorBody,
                    409: errorBody,
                    500: errorBody,
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

            if (!session.profile) {
                return reply.status(409).send({
                    error: {
                        code: "profile_required",
                        message: "User must complete onboarding before accessing this resource.",
                    },
                });
            }

            try {
                const personId = request.body.id;

                // The user own today, not the server one: in Auckland it is already
                // tomorrow while Germany is still asleep, and the app asks for the date
                // its own clock shows.
                const date = dayjs()
                    .tz(session.profile.timezone ?? "UTC")
                    .format("YYYY-MM-DD");

                /**
                 * The person as stored, with today's reading if there is one. Left join:
                 * a day nobody has scored yet must not make the update fail.
                 */
                const [previous] = await fastify.db
                    .select({
                        birthDate: compatibilityPeople.birthDate,
                        birthTime: compatibilityPeople.birthTime,
                        birthPlaceLat: compatibilityPeople.birthPlaceLat,
                        birthPlaceLng: compatibilityPeople.birthPlaceLng,
                        status: compatibilityPeopleScores.status,
                    })
                    .from(compatibilityPeople)
                    .leftJoin(
                        compatibilityPeopleScores,
                        and(
                            eq(compatibilityPeopleScores.personId, compatibilityPeople.id),
                            eq(compatibilityPeopleScores.date, date)
                        )
                    )
                    .where(and(eq(compatibilityPeople.id, personId), eq(compatibilityPeople.userId, session.user.id)))
                    .limit(1);

                if (!previous) {
                    return reply.status(404).send({
                        error: { code: "not_found", message: "No such compatibility person." },
                    });
                }

                /**
                 * Only the birth data changes the chart, and so the reading. A new name,
                 * gender or relationship is saved and nothing else happens — the reading
                 * already written keeps the old wording until the next day is written.
                 *
                 * The stored time carries seconds (`HH:mm:ss`), the body does not.
                 */
                const birthChanged =
                    previous.birthDate !== request.body.birthDate ||
                    (previous.birthTime?.slice(0, 5) ?? null) !== request.body.birthTime ||
                    previous.birthPlaceLat !== request.body.birthPlaceLat ||
                    previous.birthPlaceLng !== request.body.birthPlaceLng;

                // Get sun sign from birth date
                const sunSign: ZodiacSign = getSunSign(dayjs(request.body.birthDate).toDate()).name;

                // Use timezone from session if available
                let timezone = session.profile.timezone;

                // If birthPlace is provided, use detected timezone
                if (
                    request.body.birthPlace &&
                    request.body.birthPlaceLat !== null &&
                    request.body.birthPlaceLng !== null
                ) {
                    const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0];
                    if (detectedTimezone) {
                        // Use detected timezone
                        timezone = detectedTimezone;
                    }
                }

                // Compute birth chart: 10 planets, plus the Ascendant when the birth time is known
                const { chart: birthChart } = computeNatalChart({
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    timezone,
                });

                // Compute moon sign
                const moonSign: ZodiacSign = birthChart.moon.sign;

                // null without a birth time — an Ascendant derived from an assumed noon is meaningless
                const risingSign: ZodiacSign | null = birthChart.ascendant?.sign ?? null;

                // Compute base compatibility between the person and the current user
                const baseCompatibility = calculateCompatibility(session.profile.birthChart, birthChart);

                // How compatible they are at all — a comparison against every other pair
                const baseScore = normalizeScore(baseCompatibility.overall, BASE_NORMALIZER);

                /**
                 * Every day from today on, scored against the new chart. Only days that
                 * already have a row: the rest are scored on read, from the new chart.
                 * Sampled at local noon of the user own zone, so a date means the same
                 * span of time here as it does on their screen.
                 */
                const upcomingDates = birthChanged
                    ? await fastify.db
                          .select({ date: compatibilityPeopleScores.date })
                          .from(compatibilityPeopleScores)
                          .where(
                              and(
                                  eq(compatibilityPeopleScores.personId, personId),
                                  gt(compatibilityPeopleScores.date, date)
                              )
                          )
                          .then((rows) => rows.map((row) => row.date))
                    : [];

                const rescored: ({ date: string } & ReturnType<typeof scoreDay>)[] = [];

                for (const day of [date, ...upcomingDates]) {
                    const transits = await getOrCreateTransits(fastify.db, day, session.profile.timezone);

                    rescored.push({
                        date: day,
                        ...scoreDay({
                            readerChart: session.profile.birthChart,
                            personChart: birthChart,
                            baseOverall: baseCompatibility.overall,
                            transits: transits.planets,
                        }),
                    });
                }

                const today = rescored[0]!;

                /**
                 * A new chart is a new reading, and a new reading is a new purchase.
                 *
                 * Charged only when today was bought and the text is delivered or on its
                 * way — otherwise there is nothing to rewrite. A subscriber passes as
                 * `unlimited` and pays nothing. Checked before anything is written, so a
                 * reader who cannot afford it keeps the person as it was.
                 */
                const access = await checkAccess(fastify.db, {
                    userId: session.user.id,
                    feature: "compatibilityDetail",
                    resourceKey: creditKeys.compatibilityDetail(personId, date),
                });

                const needsCharge =
                    birthChanged &&
                    !access.unlimited &&
                    access.unlocked &&
                    (previous.status === "ready" || previous.status === "pending");

                if (needsCharge && !access.affordable) {
                    const credits = await getCreditState(fastify.db, session.user.id);

                    return reply.status(402).send({
                        error: {
                            code: "insufficient_credits" as const,
                            message: "Not enough credits to rewrite this reading.",
                            silent: true as const,
                            details: {
                                feature: "compatibilityDetail",
                                cost: access.cost,
                                balance: credits.balance,
                                nextCreditAt: credits.nextCreditAt?.toISOString() ?? null,
                            },
                        },
                    });
                }

                await fastify.db.transaction(async (tx) => {
                    await tx
                        .update(compatibilityPeople)
                        .set({
                            name: request.body.name,
                            gender: request.body.gender,
                            relationship: request.body.relationship,
                            birthDate: request.body.birthDate,
                            birthTime: request.body.birthTime,
                            birthPlace: request.body.birthPlace,
                            birthPlaceLat: request.body.birthPlaceLat,
                            birthPlaceLng: request.body.birthPlaceLng,
                            sunSign,
                            moonSign,
                            risingSign,
                            birthChart,
                            baseScore,
                            baseCompatibility,
                            timezone,
                        })
                        .where(
                            and(eq(compatibilityPeople.id, personId), eq(compatibilityPeople.userId, session.user.id))
                        );

                    if (!birthChanged) {
                        return;
                    }

                    /**
                     * The readings from today on were written about someone else. Left
                     * as `absent`, so the next read starts a fresh one; the new timestamp
                     * also makes a run still writing the old one discard its result.
                     */
                    for (const day of rescored) {
                        await tx
                            .insert(compatibilityPeopleScores)
                            .values({
                                date: day.date,
                                personId,
                                score: day.score,
                                compatibility: day.compatibility,
                            })
                            .onConflictDoUpdate({
                                target: [compatibilityPeopleScores.personId, compatibilityPeopleScores.date],
                                set: {
                                    score: day.score,
                                    compatibility: day.compatibility,
                                    content: null,
                                    status: "absent",
                                    updatedAt: sql`date_trunc('milliseconds', now())`,
                                },
                            });
                    }

                    /**
                     * Past days keep what the reader already read, with the score it was
                     * written from. Past days with nothing written go, so the timeline
                     * scores them again from the new chart.
                     */
                    await tx
                        .delete(compatibilityPeopleScores)
                        .where(
                            and(
                                eq(compatibilityPeopleScores.personId, personId),
                                lt(compatibilityPeopleScores.date, date),
                                isNull(compatibilityPeopleScores.content)
                            )
                        );

                    /**
                     * What was bought from today on was a reading of the old chart. Taken
                     * back without a refund: today is bought again below, and an upcoming
                     * day is bought again when it is opened. Refunding would make every
                     * edit a free reading.
                     */
                    if (!access.unlimited) {
                        await revokeUnlocks(tx, {
                            userId: session.user.id,
                            feature: "compatibilityDetail",
                            resourceKeys: [...(needsCharge ? [date] : []), ...upcomingDates].map((day) =>
                                creditKeys.compatibilityDetail(personId, day)
                            ),
                        });
                    }
                });

                /**
                 * After the commit, because `spendCredits` runs its own transaction. If it
                 * loses a race for the balance, the person is still saved and today is
                 * simply locked — the reader can unlock it from the detail.
                 */
                let rewrite = birthChanged && access.unlocked;

                if (needsCharge) {
                    const spend = await spendCredits(fastify.db, {
                        userId: session.user.id,
                        feature: "compatibilityDetail",
                        resourceKey: creditKeys.compatibilityDetail(personId, date),
                    });

                    if (!spend.ok) {
                        request.log.warn({ personId, date }, "Rewrite after an update not charged, today left locked");
                    }

                    rewrite = spend.ok;
                }

                if (rewrite) {
                    await startCompatibilityGeneration(fastify, {
                        person: {
                            id: personId,
                            name: request.body.name,
                            gender: request.body.gender,
                            relationship: request.body.relationship,
                            sign: sunSign,
                            score: today.score,
                            compatibility: today.compatibility,
                        },
                        profile: session.profile,
                        date,
                        allowFailed: true,
                    });
                }

                return reply.status(200).send({
                    data: { compatibilityPersonId: personId },
                });
            } catch (error: unknown) {
                if (error instanceof EphemerisError) {
                    request.log.error({ err: error }, "Failed to compute birth chart");

                    return reply.status(409).send({
                        error: {
                            code: "birth_chart_failed",
                            message: "Birth chart could not be computed.",
                        },
                    });
                }

                return sendInternalError(request, reply, error, "Failed to update compatibility person");
            }
        }
    );
}) satisfies FastifyPluginAsync;
