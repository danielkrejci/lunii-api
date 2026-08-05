import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { and, eq, isNull } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { NatalChart } from "../../../modules/astro";
import { generateDailyOverview } from "../../../modules/compatibilityPeople/ai";
import { calculateDailyCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { normalizeScore, OVERALL_NORMALIZER } from "../../../modules/compatibilityPeople/normalizer";
import { getOrCreateTransits } from "../../../modules/dailyScore/service";
import { serializeDrizzleData } from "../../../utils/drizzleUtils";
import { Genders, Relationships, SINGS_MAP } from "../../../utils/natalUtils";

const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

const overviewBlock = z.object({
    title: z.string(),
    description: z.string(),
    reason: z.string(),
});

/**
 * Shared by the read and the generate route so a generate response can go straight
 * into the client's query cache without a refetch.
 *
 * The compatibility score is deterministic and always present. Only the written
 * parts are nullable, because they cost an AI request.
 */
const responseSchema = z.object({
    data: z.object({
        id: z.string(),
        name: z.string(),
        gender: z.enum(Genders),
        relationship: z.enum(Relationships),
        birthDate: z.string(),
        birthTime: z.string().nullable(),
        birthPlace: z.string().nullable(),
        birthPlaceLat: z.number().nullable(),
        birthPlaceLng: z.number().nullable(),
        sign: z.enum(SINGS_MAP),
        image: z.string().nullable(),
        baseCompatibility: z.any(),
        baseScore: z.number(),
        compatibility: z.any(),
        score: z.number(),
        date: z.string(),
        /** False while the written fields are still null. */
        generated: z.boolean(),
        overview: z.string().nullable(),
        positiveOverview: overviewBlock.nullable(),
        negativeOverview: overviewBlock.nullable(),
        insights: z
            .array(
                z.object({
                    title: z.string(),
                    description: z.string(),
                    reason: z.string(),
                    category: z.string(),
                    direction: z.string(),
                })
            )
            .nullable(),
        practicalAdvice: z.string().nullable(),
    }),
});

function loadPerson(db: FastifyInstance["db"], input: { userId: string; personId: string; date: string }) {
    return (
        db
            .select({
                id: compatibilityPeople.id,
                name: compatibilityPeople.name,
                gender: compatibilityPeople.gender,
                relationship: compatibilityPeople.relationship,
                birthDate: compatibilityPeople.birthDate,
                birthTime: compatibilityPeople.birthTime,
                birthPlace: compatibilityPeople.birthPlace,
                birthPlaceLat: compatibilityPeople.birthPlaceLat,
                birthPlaceLng: compatibilityPeople.birthPlaceLng,
                sign: compatibilityPeople.sunSign,
                image: compatibilityPeople.image,
                birthChart: compatibilityPeople.birthChart,
                baseCompatibility: compatibilityPeople.baseCompatibility,
                baseScore: compatibilityPeople.baseScore,
                score: compatibilityPeopleScores.score,
                compatibility: compatibilityPeopleScores.compatibility,
                overview: compatibilityPeopleScores.overview,
                positiveOverview: compatibilityPeopleScores.positiveOverview,
                negativeOverview: compatibilityPeopleScores.negativeOverview,
                insights: compatibilityPeopleScores.insights,
                practicalAdvice: compatibilityPeopleScores.practicalAdvice,
                date: compatibilityPeopleScores.date,
            })
            .from(compatibilityPeople)
            // Left, not inner: the person must come back even on a day that has no score
            // row yet, so this route can compute one instead of pretending they do not exist.
            .leftJoin(
                compatibilityPeopleScores,
                and(
                    eq(compatibilityPeopleScores.personId, compatibilityPeople.id),
                    eq(compatibilityPeopleScores.date, input.date)
                )
            )
            .where(and(eq(compatibilityPeople.id, input.personId), eq(compatibilityPeople.userId, input.userId)))
            .limit(1)
            .then((rows) => rows.at(0) ?? null)
    );
}

type PersonRow = NonNullable<Awaited<ReturnType<typeof loadPerson>>>;

/** A person whose daily score exists — what both routes work with. */
type Person = PersonRow & { score: number; compatibility: NonNullable<PersonRow["compatibility"]> };

/**
 * The person for a date, computing and storing the daily score when it is missing.
 *
 * Until now only /list created those rows, so a deep link or a prefetched detail
 * arriving first found nothing. The score is a pure function of the transits and both
 * charts, so computing it here costs a few milliseconds and makes the route
 * self-sufficient.
 */
async function loadPersonWithScore(
    db: FastifyInstance["db"],
    input: { userId: string; personId: string; date: string; userChart: NatalChart }
): Promise<Person | null> {
    const person = await loadPerson(db, input);

    if (!person) {
        return null;
    }

    if (person.score !== null && person.compatibility !== null) {
        return person as Person;
    }

    const { planets } = await getOrCreateTransits(db, input.date);

    const compatibility = calculateDailyCompatibility(planets, input.userChart, person.birthChart);
    const overallRaw = person.baseCompatibility.overall + compatibility.modifier;

    await db
        .insert(compatibilityPeopleScores)
        .values({
            personId: person.id,
            date: input.date,
            score: normalizeScore(overallRaw, OVERALL_NORMALIZER),
            compatibility,
        })
        // Another request may have inserted the same (personId, date) meanwhile. The
        // value is deterministic, so whichever row won holds what this one computed.
        .onConflictDoNothing();

    const stored = await loadPerson(db, input);

    return stored && stored.score !== null && stored.compatibility !== null ? (stored as Person) : null;
}

function toResponse(person: Person, date: string) {
    return serializeDrizzleData({
        id: person.id,
        name: person.name,
        gender: person.gender,
        relationship: person.relationship,
        birthDate: person.birthDate,
        birthTime: person.birthTime,
        birthPlace: person.birthPlace,
        birthPlaceLat: person.birthPlaceLat,
        birthPlaceLng: person.birthPlaceLng,
        sign: person.sign,
        image: person.image,
        baseCompatibility: person.baseCompatibility,
        baseScore: person.baseScore,
        compatibility: person.compatibility,
        score: person.score,
        date,
        generated: Boolean(person.overview),
        overview: person.overview ?? null,
        positiveOverview: person.positiveOverview ?? null,
        negativeOverview: person.negativeOverview ?? null,
        insights: person.insights ?? null,
        practicalAdvice: person.practicalAdvice ?? null,
    });
}

const notFound = {
    error: {
        code: "not_found",
        message: "No such compatibility person.",
    },
};

export default (async (fastify) => {
    /* ============================================================
       READ — safe to prefetch, retry and refetch
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/detail",
        {
            schema: {
                querystring: z.object({
                    compatibilityPersonId: z.string().min(1),
                    date: z.string().refine((date) => dayjs(date).isValid(), { message: "Date is invalid" }),
                }),
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    404: errorSchema,
                    409: errorSchema,
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

            if (!session.profile) {
                return reply.status(409).send({
                    error: { code: "profile_required", message: "User must complete onboarding first." },
                });
            }

            try {
                const date = dayjs.utc(request.query.date).format("YYYY-MM-DD");

                const person = await loadPersonWithScore(fastify.db, {
                    userId: session.user.id,
                    personId: request.query.compatibilityPersonId,
                    date,
                    userChart: session.profile.birthChart,
                });

                if (!person) {
                    return reply.status(404).send(notFound);
                }

                return reply.status(200).send({ data: toResponse(person, date) });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to get compatibility person");

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

    /* ============================================================
       GENERATE — costs an AI request, so it is explicit
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/detail/generate",
        {
            schema: {
                body: z.object({
                    compatibilityPersonId: z.string().min(1),
                    date: z.string().refine((date) => dayjs(date).isValid(), { message: "Date is invalid" }),
                }),
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    404: errorSchema,
                    409: errorSchema,
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

            if (!session.profile) {
                return reply.status(409).send({
                    error: { code: "profile_required", message: "User must complete onboarding first." },
                });
            }

            try {
                const date = dayjs.utc(request.body.date).format("YYYY-MM-DD");

                const person = await loadPersonWithScore(fastify.db, {
                    userId: session.user.id,
                    personId: request.body.compatibilityPersonId,
                    date,
                    userChart: session.profile.birthChart,
                });

                if (!person) {
                    return reply.status(404).send(notFound);
                }

                // Already written: don't pay for a second overview, and don't replace text
                // the user may already be reading.
                if (person.overview) {
                    return reply.status(200).send({ data: toResponse(person, date) });
                }

                const { response: dailyOverview, input: rawInput } = await generateDailyOverview(
                    session.profile.language,
                    {
                        score: person.score,
                        modifier: person.compatibility.modifier,

                        positiveTotal: person.compatibility.positiveOverall,
                        negativeTotal: person.compatibility.negativeOverall,

                        breakdown: person.compatibility.overallBreakdown,

                        positiveAspects: person.compatibility.positiveAspects.map(({ rule, score }) => ({
                            title: rule.title,
                            description: rule.description,
                            category: rule.category,
                            planetA: rule.planetA,
                            planetB: rule.planetB,
                            score,
                        })),
                        negativeAspects: person.compatibility.negativeAspects.map(({ rule, score }) => ({
                            title: rule.title,
                            description: rule.description,
                            category: rule.category,
                            planetA: rule.planetA,
                            planetB: rule.planetB,
                            score,
                        })),

                        relationshipType: person.relationship,

                        personA: {
                            name: session.profile.name,
                            gender: session.profile.gender,
                            sunSign: session.profile.sunSign,
                        },

                        personB: {
                            name: person.name,
                            gender: person.gender,
                            sunSign: person.sign,
                        },
                    }
                );

                /**
                 * Conditional on purpose. Two concurrent generates both reach here, and
                 * whichever lands second must not overwrite text the user is already
                 * reading with an equally valid but different wording.
                 */
                await fastify.db
                    .update(compatibilityPeopleScores)
                    .set({
                        overview: dailyOverview.overview,
                        positiveOverview: dailyOverview.positiveOverview,
                        negativeOverview: dailyOverview.negativeOverview,
                        insights: dailyOverview.insights,
                        practicalAdvice: dailyOverview.practicalAdvice,
                        rawInput,
                    })
                    .where(
                        and(
                            eq(compatibilityPeopleScores.personId, person.id),
                            eq(compatibilityPeopleScores.date, date),
                            isNull(compatibilityPeopleScores.overview)
                        )
                    );

                // Re-read so a request that lost the race serves the winner's text.
                const written = await loadPersonWithScore(fastify.db, {
                    userId: session.user.id,
                    personId: request.body.compatibilityPersonId,
                    date,
                    userChart: session.profile.birthChart,
                });

                return reply.status(200).send({ data: toResponse(written ?? person, date) });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate compatibility overview");

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
