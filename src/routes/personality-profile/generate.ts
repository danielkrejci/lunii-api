import { GoogleGenAI } from "@google/genai";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../env.mjs";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/generate",
        {
            schema: {
                body: z.object({
                    gender: z.string().min(1, "Gender is required"),
                    zodiacSign: z.string().min(1, "Zodiac sign is required"),
                    relationshipStatus: z.string().min(1, "Relationship status is required"),
                    careerStage: z.string().min(1, "Career stage is required"),
                    decisionStyle: z.string().min(1, "Decision style is required"),
                    areasOfInterest: z
                        .array(z.string())
                        .min(1, "Areas of interest are required")
                        .max(3, "Maximum 3 areas of interest"),
                    goalsForTheYear: z
                        .array(z.string())
                        .min(1, "Goals for the year are required")
                        .max(3, "Maximum 3 goals for the year"),
                    contentPreference: z.string().min(1, "Content preference is required"),
                    beliefLevel: z.string().min(1, "Belief level is required"),
                }),
                response: {
                    200: z.object({
                        data: z.string(),
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
            const ai = new GoogleGenAI({
                apiKey: env.GEMINI_API_KEY,
            });

            try {
                const prompt = `
                    Generate a short personality profile.

                    Output exactly 4 sections:
                    1. Strengths
                    2. Challenges
                    3. Current focus
                    4. Guidance

                    Return JSON only.
                    {
                        "strengths": "...",
                        "challenges": "...",
                        "focus": "...",
                        "guidance": "..."
                    }

                    Rules:
                    - Each field: 110 characters max
                    - Write like a thoughtful human coach, not a horoscope
                    - Avoid generic astrology clichés and vague statements
                    - Be specific and grounded in real-life behavior
                    - Challenges must feel constructive, not negative or judgmental
                    - Guidance must be practical and actionable
                    - Do NOT repeat the same idea across sections
                    - Do NOT use phrases like "you are destined", "the universe", "cosmic energy"

                    Tone:
                    - calm, clear, slightly reflective
                    - modern, not mystical
                    - feels personal and believable

                    User data:
                    - Zodiac sign: ${request.body.zodiacSign}
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

                console.log(response.text);

                return reply.status(200).send({
                    data: response.text ?? "",
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
