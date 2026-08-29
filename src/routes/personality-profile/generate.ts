import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { aiGenerations } from "../../db/schema";
import { ai } from "../../lib/ai";
import { auth } from "../../lib/auth";
import { computeNatalChart, findNatalAspects, NatalAspect, NatalChart } from "../../modules/astro";
import { VOICE_RULES } from "../../modules/insights/voice";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { Gender, Genders } from "../../utils/natalUtils";
import { humanizeEnum, humanizeEnums, parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { MIN_AGE } from "../profile/add";

dayjs.extend(utc);
dayjs.extend(timezone);

const MODEL = "gemini-2.5-flash";

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * How many standing aspects reach the prompt.
 *
 * Five rather than all of them: a chart makes twenty-odd aspects to itself and a list
 * that long stops being "what defines this person" and becomes an ephemeris dump the
 * model averages out.
 */
const NATAL_ASPECT_LIMIT = 5;

/**
 * The five sections, as the model must return them.
 *
 * Handed to the decoder as a response schema, so an answer that does not fit stops being
 * possible instead of being caught afterwards — this used to fall back to five empty
 * strings and store them without anyone noticing.
 */
const answerSchema = z.object({
    core: z.string(),
    emotions: z.string(),
    expression: z.string(),
    relationships: z.string(),
    growth: z.string(),
});

type PersonalityProfile = z.infer<typeof answerSchema>;

const EMPTY_PROFILE: PersonalityProfile = {
    core: "",
    emotions: "",
    expression: "",
    relationships: "",
    growth: "",
};

/* ============================================================
   PROMPT
============================================================ */

function describeNatalAspects(aspects: NatalAspect[]): string {
    if (aspects.length === 0) {
        return "This chart makes no close aspect to itself — nothing here pulls against anything else.";
    }

    return aspects
        .slice(0, NATAL_ASPECT_LIMIT)
        .map(
            (aspect) =>
                `- ${aspect.a} ${aspect.aspect} ${aspect.b} (${aspect.group}, ${aspect.orb.toFixed(1)}° from exact)`
        )
        .join("\n");
}

export function buildPrompt(input: {
    chart: NatalChart;
    aspects: NatalAspect[];
    sunSign: string;
    risingSign: string | null;
    relationshipStatus: string;
    careerStage: string;
    decisionStyle: string;
    areasOfInterest: string[];
    goalsForTheYear: string[];
    contentPreference: string;
    beliefLevel: string;
    language: string;
}): string {
    const { chart } = input;

    const decisionStyle = humanizeEnum(input.decisionStyle);
    const careerStage = humanizeEnum(input.careerStage);
    const relationshipStatus = humanizeEnum(input.relationshipStatus);
    const goals = humanizeEnums(input.goalsForTheYear).join(", ");
    const interests = humanizeEnums(input.areasOfInterest).join(", ");

    /**
     * Without a birth time the Ascendant is an artefact of an assumed noon, so section 3
     * is given something real to work from instead of a placement that was invented.
     */
    const expressionBrief = input.risingSign
        ? `how they come across before people know them. The Rising sign read against the Sun — what the first impression promises, and where the person behind it differs.`
        : `how they come across before people know them. No birth time was given, so there is no Ascendant: build this from the distance between the Sun and the Moon instead, and never describe an outward style as if it were established.`;

    return `==================================================
LANGUAGE AND FORM OF ADDRESS
==================================================

${input.language}

This governs every field you return. It is repeated at the end; check it again before you
answer.

You are writing the personal profile a new user reads when they join an astrology app.

It is the first substantial thing they read about themselves, and it decides whether they
believe this app knows them.

==================================================
THEIR CHART
==================================================

Sun: ${input.sunSign}
Moon: ${chart.moon.sign}
Rising: ${input.risingSign ?? "unknown — no birth time was given"}
Mercury: ${chart.mercury.sign}
Venus: ${chart.venus.sign}
Mars: ${chart.mars.sign}
Saturn: ${chart.saturn.sign}

What the chart does to itself — the tensions and supports they carry permanently:

${describeNatalAspects(input.aspects)}

==================================================
THEM
==================================================

Decides by: ${decisionStyle}
Career right now: ${careerStage}
Relationship: ${relationshipStatus}
Cares about: ${interests}
Working towards this year: ${goals}

==================================================
HOW TO WRITE THIS
==================================================

Every section is the intersection of the chart and their life, and it needs both in
roughly equal measure.

The CHART supplies the substance: what this person is actually like, how they are built,
what they do under pressure. That comes from the placements above and nowhere else — it
is why two people in the same job with the same decision style get different profiles.

Their LIFE supplies the setting: where that pattern is showing up for them right now.

Lead with the pattern, land it in their life. A section that only names the pattern is a
horoscope. A section that only describes their circumstances is a summary of a sign-up
form, and they filled that in five minutes ago — they will notice.

Two tests, and a section has to pass both:

- Swap in the opposite decision style, career stage and goals, same chart. If the section
  reads the same, their life is missing.
- Swap in a different chart, same life facts. If the section reads the same, the chart is
  missing — and this is the easier mistake to make, because their answers are concrete and
  the chart is not.

Use, never name. Not "your Scorpio Moon", not "as someone who researches everything",
not "since you are ${relationshipStatus}". Show what it does, not that you know it.

==================================================
SECTIONS
==================================================

1. core — the person the Sun and Mercury describe: what drives them, how they think,
   how they arrive at a decision. Then where that is visible right now, given that they
   decide by ${decisionStyle} and their career is ${careerStage}.

2. emotions — what the Moon says about how they take things in and recover. Then how that
   sits with the way they decide: the two either work together or pull against each other,
   and saying which is the point of this section.

3. expression — ${expressionBrief}

4. relationships — what Venus and Mars say they are drawn to and what they struggle to
   ask for. Then how that plays out for someone who is ${relationshipStatus}.

5. growth — start from the standing aspects: that is the friction they carry regardless of
   circumstances. Then set it against what they are trying to do this year (${goals}) and
   say where the two collide. This section has to name something specific enough to be
   slightly uncomfortable.

Where a concrete example helps, take it from what they care about: ${interests}.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON:

{
    "core": "string",
    "emotions": "string",
    "expression": "string",
    "relationships": "string",
    "growth": "string"
}

- Each field is 2–3 sentences, at most 220 characters.
- Describe patterns and behaviour, never labels or traits.
- No section may repeat another's idea.
- No astrology vocabulary, no zodiac names, and none of "the universe", "cosmic energy"
  or "you are destined".

==================================================
HOW TO WRITE IT
==================================================

${VOICE_RULES}

This is a description of a person rather than of a day. Never name a planet, a sign or an
aspect — naming them is what turns this into a horoscope. But the placement still has to
be unmistakably present in what you say: someone who knows charts should be able to read
the section and tell which one it came from. Observant and
psychologically believable — someone who has been paying attention, not someone reading a
chart aloud, and not a therapist.

They describe their belief in astrology as "${humanizeEnum(input.beliefLevel)}" and prefer
content that is "${humanizeEnum(input.contentPreference)}". Match that register. Never
write about it.

Respond only in:
${input.language}`;
}

/* ============================================================
   ROUTE
============================================================ */

export default (async (fastify) => {
    await fastify.register(rateLimit, {
        max: 5,
        timeWindow: "1 day",
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });
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
        "/generate",
        {
            schema: {
                body: z.object({
                    language: z.string().min(1, "Please select your preferred language."),
                    gender: z
                        .string()
                        .min(1, "Please select your gender.")
                        .refine((value) => Genders.includes(value as Gender), "Invalid gender."),
                    /** Wall clock, not an instant — see profile/add for why. */
                    birthDate: z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Birth date must be YYYY-MM-DD.")
                        .refine(
                            (date) => {
                                const today = new Date();
                                const minDate = new Date(
                                    today.getFullYear() - MIN_AGE,
                                    today.getMonth(),
                                    today.getDate()
                                );
                                return new Date(date) <= minDate;
                            },
                            {
                                message: `You must be at least ${MIN_AGE} years old.`,
                            }
                        ),
                    birthTime: z
                        .string()
                        .regex(/^\d{2}:\d{2}$/u, "Birth time must be HH:mm.")
                        .nullable(),
                    birthPlace: z.string().min(1, "Please enter your birth place."),
                    birthPlaceLat: z
                        .number()
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    birthPlaceLng: z
                        .number()
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    country: z.string().min(1, "Please select your country."),
                    sunSign: z.string().min(1, "Please select your Sun sign."),
                    relationshipStatus: z.string().min(1, "Please select the option that best suits you."),
                    careerStage: z.string().min(1, "Please select the option that best suits you."),
                    decisionStyle: z.string().min(1, "Please select the option that best suits you."),
                    areasOfInterest: z
                        .array(z.string())
                        .min(1, "Please select 1 to 3 options that best suit you.")
                        .max(3, "You can select up to 3 areas of interest."),
                    goalsForTheYear: z
                        .array(z.string())
                        .min(1, "Please select 1 to 3 goals for this year.")
                        .max(3, "You can select up to 3 goals for this year."),
                    contentPreference: z.string().min(1, "Please select your content preference."),
                    beliefLevel: z.string().min(1, "Please select your belief level."),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            sunSign: z.string(),
                            moonSign: z.string(),
                            risingSign: z.string().nullable(),
                            personalityProfile: z.string(),
                            personalityProfileInput: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    409: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    500: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
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

            const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0] || "UTC";

            /**
             * The whole chart in one call, rather than the Moon and the Ascendant computed
             * inline from two raw swisseph calls. Same instant and same house system as
             * before — this route was the last one still building its own chart — and the
             * rest of the placements are what lets the profile be about more than three
             * signs.
             */
            let chart: NatalChart;

            try {
                chart = computeNatalChart({
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    timezone: detectedTimezone,
                }).chart;
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to compute natal chart");

                return reply.status(409).send({
                    error: {
                        code: "transit_calculation_error",
                        message: error instanceof Error ? error.message : "Natal chart could not be computed.",
                    },
                });
            }

            const moonSign = chart.moon.sign;

            /**
             * Null without a birth time. The Ascendant moves a full sign roughly every
             * two hours, so deriving it from an assumed noon returns an essentially
             * random sign — null is the honest answer, and the scoring engine skips the
             * Ascendant rather than trusting a fabricated one.
             */
            const risingSign = chart.ascendant?.sign ?? null;

            const language = getLanguageByIso(request.body.language);

            const prompt = buildPrompt({
                chart,
                aspects: findNatalAspects(chart, {
                    personalOnly: true,
                    widenNatalMoon: request.body.birthTime === null,
                }),
                sunSign: request.body.sunSign,
                risingSign,
                relationshipStatus: request.body.relationshipStatus,
                careerStage: request.body.careerStage,
                decisionStyle: request.body.decisionStyle,
                areasOfInterest: request.body.areasOfInterest,
                goalsForTheYear: request.body.goalsForTheYear,
                contentPreference: request.body.contentPreference,
                beliefLevel: request.body.beliefLevel,
                language: language
                    ? buildPromptLanguageRule(language, request.body.gender as Gender)
                    : request.body.language,
            });

            try {
                let personalityProfile: PersonalityProfile | null = null;

                // One retry, because most failures here are a timeout or a rate limit
                // rather than anything a second attempt would hit again.
                for (let attempt = 1; attempt <= 2 && !personalityProfile; attempt++) {
                    const startedAt = Date.now();

                    const response = await ai.models.generateContent({
                        model: MODEL,
                        contents: prompt,
                        config: {
                            /**
                             * Thinking off. Measured on the daily prompt: the default budget spends
                             * 2 000–9 500 hidden tokens, costs 40 % more and takes 48–64 s instead of 27 s,
                             * and the only thing it bought was reaching back for the address rule buried at
                             * the end of the prompt. That rule now sits at the top as well, so there is
                             * nothing left for it to buy.
                             */
                            thinkingConfig: { thinkingBudget: 0 },
                            responseMimeType: "application/json",
                            responseJsonSchema: toResponseJsonSchema(answerSchema),
                        },
                    });

                    const raw = parseLLMJson<unknown>(response.text ?? "");
                    const parsed = raw === null ? null : answerSchema.safeParse(raw);

                    personalityProfile = parsed?.success ? parsed.data : null;

                    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
                    /**
                     * Thinking tokens are billed at the output rate but are not part of
                     * `candidatesTokenCount`, so leaving them out under-reported every generation by
                     * 30–45 % while the default budget was on. Counted here so the audit row is what
                     * was actually charged rather than what was visible.
                     */
                    const outputTokens =
                        (response.usageMetadata?.candidatesTokenCount ?? 0) +
                        (response.usageMetadata?.thoughtsTokenCount ?? 0);

                    // Audit only — never allowed to fail onboarding.
                    await fastify.db
                        .insert(aiGenerations)
                        .values({
                            userId: session.user.id,
                            type: "personalityProfile",
                            status: personalityProfile ? "success" : "error",
                            error: personalityProfile
                                ? null
                                : `Unusable answer (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`,
                            requestId: response.responseId ?? "",
                            provider: "google",
                            model: MODEL,
                            input: prompt,
                            output: response.text ?? "",
                            inputTokens,
                            outputTokens,
                            total_tokens: response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
                            latencyMs: Date.now() - startedAt,
                            cost:
                                (inputTokens / 1_000_000) * PRICE_PER_MILLION.input +
                                (outputTokens / 1_000_000) * PRICE_PER_MILLION.output,
                        })
                        .catch((error: unknown) => request.log.error({ err: error }, "Failed to log AI generation"));
                }

                /**
                 * An empty profile still completes onboarding: the sign-up is worth more
                 * than the text, and the profile can be written again later. It is logged
                 * loudly because everything downstream reads this column — a reader whose
                 * profile is blank gets the generic half of every daily prompt.
                 */
                if (!personalityProfile) {
                    request.log.error({ userId: session.user.id }, "Personality profile came back unusable twice");
                }

                return reply.status(200).send({
                    data: {
                        sunSign: request.body.sunSign,
                        moonSign,
                        risingSign,
                        personalityProfile: JSON.stringify(personalityProfile ?? EMPTY_PROFILE),
                        personalityProfileInput: prompt,
                    },
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate personality profile");

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
