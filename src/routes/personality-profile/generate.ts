import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { ai } from "../../lib/ai";
import swisseph from "../../lib/swisseph";
import { Gender, Genders, SINGS_MAP } from "../../utils/natalUtils";
import { parseLLMJson } from "../../utils/stringUtils";
import { MIN_AGE } from "../profile/add";

dayjs.extend(utc);
dayjs.extend(timezone);

export default (async (fastify) => {
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
                    birthDate: z.string().refine(
                        (date) => {
                            const today = new Date();
                            const minDate = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
                            return new Date(date) <= minDate;
                        },
                        {
                            message: `You must be at least ${MIN_AGE} years old.`,
                        }
                    ),
                    birthTime: z.string().nullable(),
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
                            risingSign: z.string(),
                            personalityProfile: z.string(),
                            personalityProfileInput: z.string(),
                        }),
                    }),
                    400: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                },
            },
        },
        async (request, reply) => {
            const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0] || "UTC";

            const birthDate = dayjs(request.body.birthDate);
            const birthTime = request.body.birthTime ? dayjs(request.body.birthTime) : dayjs().hour(12).minute(0);

            const absoluteBirthDate = dayjs
                .tz(birthDate.format("YYYY-MM-DD"), detectedTimezone)
                .hour(birthTime.hour())
                .minute(birthTime.minute())
                .second(0)
                .millisecond(0)
                .toDate();

            // compute moon sign
            const jdMoon = swisseph.swe_julday(
                absoluteBirthDate.getUTCFullYear(),
                absoluteBirthDate.getUTCMonth() + 1,
                absoluteBirthDate.getUTCDate(),
                absoluteBirthDate.getUTCHours() + absoluteBirthDate.getUTCMinutes() / 60,
                swisseph.SE_GREG_CAL
            );

            const moonResult = swisseph.swe_calc_ut(jdMoon, swisseph.SE_MOON, 0);

            if ("error" in moonResult) {
                return reply.status(400).send({ error: { message: moonResult.error } });
            }

            if (!("longitude" in moonResult)) {
                return reply.status(400).send({ error: { message: "Moon sign not found" } });
            }

            const moonSign = SINGS_MAP[Math.floor(moonResult.longitude / 30)];

            // compute risign sign
            const jdRising = swisseph.swe_julday(
                absoluteBirthDate.getUTCFullYear(),
                absoluteBirthDate.getUTCMonth() + 1,
                absoluteBirthDate.getUTCDate(),
                absoluteBirthDate.getUTCHours() + absoluteBirthDate.getUTCMinutes() / 60,
                swisseph.SE_GREG_CAL
            );

            const houses = swisseph.swe_houses(
                jdRising,
                request.body.birthPlaceLat,
                request.body.birthPlaceLng,
                "P" // Placidus system
            );

            if ("error" in houses) {
                return reply.status(400).send({ error: { message: houses.error } });
            }

            const risingSign = SINGS_MAP[Math.floor(houses.ascendant / 30)];

            // get personality profile from AI
            try {
                const prompt = `
                Generate a personal life insight based on astrology.

                    Structure the output into 5 distinct sections:

                    1. Core self (Sun sign) – how the person naturally acts and expresses themselves
                    2. Emotional world (Moon sign) – how they feel, react, and process emotions
                    3. Outer expression (Rising sign) – how they appear to others and approach life
                    4. Relationships – how they connect with people and what they seek
                    5. Growth & tension – where they experience friction and how they evolve

                    Return JSON only:
                    {
                        "core": "...",
                        "emotions": "...",
                        "expression": "...",
                        "relationships": "...",
                        "growth": "..."
                    }

                    Rules:
                    - Each field: 1–2 sentences, max 140 characters
                    - Each section must describe a different aspect of the person
                    - Write like a thoughtful, observant human (not a horoscope)
                    - Avoid generic astrology clichés and vague statements
                    - Be specific and grounded in real-life behavior
                    - Describe patterns and tendencies, not labels or traits
                    - Do NOT repeat the same idea across sections
                    - Avoid buzzwords and abstract language
                    - Avoid obvious zodiac descriptions
                    - Do NOT use phrases like "you are destined", "the universe", "cosmic energy"

                    Tone:
                    - insightful, observant, psychologically believable
                    - feels like someone understood you, not described a sign
                    - modern and grounded

                    Language:
                    - Respond in ${request.body.language}

                    User data:
                    - Sun sign: ${request.body.sunSign}
                    - Moon sign: ${moonSign}
                    - Rising sign: ${risingSign}
                    - Relationship: ${request.body.relationshipStatus}
                    - Current career state: ${request.body.careerStage}
                    - Decision style: ${request.body.decisionStyle}
                    - Priorities / areas of interest: ${request.body.areasOfInterest.join(", ")}
                    - Goals for the year: ${request.body.goalsForTheYear.join(", ")}
                    - Content preference: ${request.body.contentPreference}
                    - Spiritual belief level: ${request.body.beliefLevel}
                  `;

                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: prompt,
                });

                // const response = {
                //     text: '{"core":"Vaše přirozenost se projevuje vnímavostí k okolním náladám a nenápadnou schopností splynout s prostředím. Intuitivně chápete nevyslovené.","emotions":"Váš emoční svět je hluboký a skrytý, intenzivně prožíváte pocity, které jen tak neukážete. Hledáte skutečnou intimitu a pravdu.","expression":"Navzdory vnitřní citlivosti působíte na ostatní přímočaře a energicky. Do nových věcí se pouštíte s elánem a sebedůvěrou.","relationships":"V partnerství toužíte po hluboké, transformativní vazbě založené na důvěře a sdílené intenzitě. Snažíte se o opravdové pochopení.","growth":"Vnitřní rozpor mezi citlivostí a ráznou vnější akcí je zdrojem růstu. Učíte se transformovat hluboké pocity v konstruktivní činy."}',
                // };

                const personalityProfile = parseLLMJson<{
                    core: string;
                    emotions: string;
                    expression: string;
                    relationships: string;
                    growth: string;
                }>(response.text ?? "") ?? {
                    core: "",
                    emotions: "",
                    expression: "",
                    relationships: "",
                    growth: "",
                };

                // console.log({
                //     sunSign: request.body.sunSign.toLowerCase(),
                //     moonSign,
                //     risingSign,
                //     personalityProfile,
                // });

                return reply.status(200).send({
                    data: {
                        sunSign: request.body.sunSign,
                        moonSign,
                        risingSign,
                        personalityProfile: JSON.stringify(personalityProfile),
                        personalityProfileInput: prompt,
                    },
                });
            } catch (e: any) {
                return reply.status(400).send({
                    error: {
                        message: "detail" in e ? e.detail : "message" in e ? e.message : "Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
