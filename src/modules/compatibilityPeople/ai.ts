import { z } from "zod";

import { ai } from "../../lib/ai";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { Gender, Relationship, ZodiacSign } from "../../utils/natalUtils";
import { parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { buildReaderBlock, Reader } from "../insights/reader";
import { REASON_RULES, VOICE_RULES } from "../insights/voice";
import { CompatibilityContact } from "./contacts";
import { TransitBreakdown } from "./types";

/* ============================================================
   WHAT IS STORED
============================================================ */

/**
 * The whole AI-written half of a person's day.
 *
 * Deliberately the same shape as the daily horoscope: a short overview, the long read as
 * paragraphs, one opportunity and one watch-out with chips, and one caption per aspect.
 * The two screens are the same voice writing about the same day, and two different
 * layouts for the same kind of reading is how they drift apart.
 */
export interface CompatibilityInsightContent {
    overview: {
        title: string;
        description: string;
    };
    /** Paragraphs. Split on the server so no screen has to parse "\n". */
    deepInsight: string[];
    opportunity: {
        description: string;
        examples: string[];
    };
    watchOut: {
        description: string;
        examples: string[];
    };
    /** What to actually do about today, for these two people. */
    practicalAdvice: string;
    /**
     * One caption per aspect, in the reader's language.
     *
     * Keyed by contact id rather than positional: the wording was written for one day's
     * aspects, and a contact that has moved on must simply have no wording.
     */
    aspects: Record<string, CompatibilityAspectText>;
}

export interface CompatibilityAspectText {
    /** "reader_moon_square_venus" — the engine's key, echoed by the model. */
    id: string;
    /**
     * The aspect's astrological name in the reader's language, and whose chart it lands
     * on: "Venuše v trigonu k Venuši Anny".
     *
     * A name, not an interpretation — it sits next to the orb and the exactness, where
     * the reader is looking at the aspect itself. What it MEANS is `description`.
     */
    title: string;
    /** What this aspect is about and what to do with it today. */
    description: string;
}

/**
 * What the model is asked to return — not quite what gets stored. The aspects come back
 * as an array and are turned into a record below, because models count badly on objects.
 *
 * Handed to the decoder as a response schema, so a malformed answer stops being possible
 * instead of being caught after the fact.
 */
const answerSchema = z.object({
    overview: z.object({ title: z.string(), description: z.string() }),
    /**
     * Paragraphs as entries, not one string with blank lines in it: asked for as a single
     * string the decoder returns one unbroken paragraph on most days, and the structure
     * only survives when it feels like it.
     */
    deepInsight: z.array(z.string()),
    opportunity: z.object({ description: z.string(), examples: z.array(z.string()) }),
    watchOut: z.object({ description: z.string(), examples: z.array(z.string()) }),
    practicalAdvice: z.string(),
    aspects: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() })),
});

export type CompatibilityInsightInput = {
    score: number;
    modifier: number;

    positiveTotal: number;
    negativeTotal: number;

    breakdown: TransitBreakdown;

    /** Today's aspects to both charts, most exact first — what the text is written from. */
    contacts: CompatibilityContact[];

    relationshipType: Relationship;

    /** The person holding the phone. Person A is them; the text is written to them. */
    reader: Reader;

    personA: {
        name: string;
        sunSign: ZodiacSign;
        gender: Gender;
    };

    personB: {
        name: string;
        sunSign: ZodiacSign;
        gender: Gender;
    };
};

/* ============================================================
   PROMPT
============================================================ */

/**
 * The aspect's name in English: "Transit Venus trine Anna's natal Venus".
 *
 * The model translates this into the reader's language, and it is what a dropped entry
 * falls back to — so it has to read as a finished label on its own, not as prompt
 * shorthand. Naming the chart owner is not decoration here: an aspect between the same
 * planet in both charts is unreadable without it.
 */
function contactLabel(contact: CompatibilityContact, personName: string): string {
    const chart = contact.side === "reader" ? "the reader's natal" : `${personName}'s natal`;

    return `Transit ${contact.transit} ${contact.aspect} ${chart} ${contact.natal}`;
}

/**
 * The aspects, as the model sees them.
 *
 * The id, the English name and the English caption are all here: the model echoes the
 * first, translates the second and reads the third for meaning. Orb and exactness let it
 * tell an aspect 0.2° from exact apart from one about to leave orb — flattened to text
 * they read identically.
 */
function buildContacts(contacts: CompatibilityContact[], personName: string): string {
    if (contacts.length === 0) {
        return "Today's sky makes no notable aspect to either chart. Write about the day as the two charts already are, and return an empty array for aspects.";
    }

    return contacts
        .map(
            (contact) =>
                `- id: ${contact.id} | ${contactLabel(contact, personName)} | "${contact.title}" | ${contact.description} | orb ${contact.orb.toFixed(1)}°, exactness ${contact.exactness}%, ${contact.supportive ? "supportive" : "difficult"}, area: ${contact.category}`
        )
        .join("\n");
}

function buildPrompt(language: string, readerBlock: string, input: CompatibilityInsightInput) {
    return `
==================================================
LANGUAGE AND FORM OF ADDRESS
==================================================

${language}

This governs every field you return. It is repeated at the end; check it again before you
answer.

==================================================
ROLE
==================================================

You write the daily reading for one relationship in a personal astrology app.

The reader opens a screen about one specific person in their life. They already see the
score for today and the aspects underneath it. Your job is the part they cannot see: what
today is actually like between the two of them.

Interpret ONLY the data supplied below. Never invent an influence that is not there.

==================================================
WHO IS READING THIS
==================================================

${input.personA.name} is reading this about ${input.personB.name}.

Write to ${input.personA.name} as "you". Never use their name — they know it.

Use ${input.personB.name}'s name. It is what makes this about these two people rather than
about a pair in general, and "the relationship" in every sentence is the register of a
generic compatibility report.

Relationship type: ${input.relationshipType}

${input.personB.name} is ${input.personB.gender}. Use gender only for grammatically
correct language.

Treat zodiac signs only as internal context. Never mention them.

==================================================
TODAY BETWEEN THEM
==================================================

Score today: ${input.score}/100

How far today moves them from their usual: ${input.modifier.toFixed(1)}

Supportive weight today: ${input.positiveTotal.toFixed(1)}
Difficult weight today: ${Math.abs(input.negativeTotal).toFixed(1)}

Where today lands, by area:

- emotional: ${input.breakdown.emotional.toFixed(1)}
- love: ${input.breakdown.love.toFixed(1)}
- communication: ${input.breakdown.communication.toFixed(1)}
- motivation: ${input.breakdown.motivation.toFixed(1)}

These numbers decide what you write. Never mention them, and never let the text disagree
with them — a day whose difficult weight is twice its supportive one is not a warm day
with a small caveat.

==================================================
WHAT TODAY IS DOING TO EACH CHART
==================================================

Today's sky is the same for both of them. What differs is the chart it lands on, and that
is what makes this about these two people.

${buildContacts(input.contacts, input.personB.name)}

An aspect to the reader's chart says what THEY bring into today. An aspect to
${input.personB.name}'s chart says what comes at them from ${input.personB.name}'s side —
their mood, their pace, what they have patience for. Say which of the two it is when it
matters; it is usually the most useful thing on the screen.

Use them as the mechanism behind what you describe. Never name them as jargon — the reader
should recognise the day, not the aspect.

${readerBlock}

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

{
    "overview": {
        "title": "string",
        "description": "string"
    },
    "deepInsight": [
        "string",
        "string",
        "string"
    ],
    "opportunity": {
        "description": "string",
        "examples": ["string", "string", "string", "string"]
    },
    "watchOut": {
        "description": "string",
        "examples": ["string", "string", "string", "string"]
    },
    "practicalAdvice": "string",
    "aspects": [
        {
            "id": "string",
            "title": "string",
            "description": "string"
        }
    ]
}

Field requirements:

- overview.title:
  Short, memorable headline for today between them (max 30-40 characters).

- overview.description:
  One concise summary of what today is like between them (max 180 characters). Mention
  both what is easy and what is not.

- deepInsight:
  The long read: what today is like between the two of them, where it will show up, and
  what to do differently. It has room, so use it for more situations and sharper advice —
  never for longer sentences or a bigger vocabulary.

  Move somewhere across it. Each paragraph carries the reader forward; one that restates
  the last in different words is the failure to watch for.

  ONE PARAGRAPH PER ARRAY ENTRY, 3-5 entries. Never put a line break inside an entry and
  never return the whole reading as a single entry - the array IS the paragraph structure,
  and one long entry renders as one wall of text.

- opportunity.description:
  What is genuinely open between them today, and what to do with it (max 150 characters).

- opportunity.examples:
  Array of exactly 4 short words or phrases - things worth doing together today.
  Name ACTIVITIES AND SITUATIONS, not feelings or qualities: "Making plans" is right,
  "Emotional depth" is not.
  Examples:
  ["Making plans", "A long talk", "Saying thanks", "Cooking together"]

- watchOut.description:
  What is most likely to go wrong between them today, and how (max 150 characters).

- watchOut.examples:
  Array of exactly 4 short words or phrases - things worth postponing or handling
  carefully today. Not vague cautions that would be true on any day.
  Examples:
  ["Money talk", "Old arguments", "Surprise plans", "Asking for a decision"]

- practicalAdvice:
  2-3 short sentences, max 180 characters. Actionable and specific to these two people
  today — say what to do, and when. Honest: on a difficult day, say the difficult thing.
  Never generic advice.

- aspects:
  Exactly one object for every aspect listed under WHAT TODAY IS DOING TO EACH CHART, in
  the same order, copying each "id" character for character. Never invent one and never
  drop one. If no aspects are listed there, return an empty array.

- aspects[].title:
  The aspect's NAME, translated: the second field of its line, the one that reads
  "Transit <planet> <aspect> <whose> natal <planet>".

  Name both planets and the angle between them, in the reader's language, using the
  ordinary name of each body as the naming rule above requires. This is the ONE field
  that says the
  geometry out loud — everything else in this answer hides it. Never replace it with a
  mood, a theme or a poetic caption, and never translate the caption in quotes instead:
  that caption is what the aspect MEANS, and its place is the description.

  Say whose chart each planet belongs to. Both planets are often the same one, and
  without it the label says nothing.

  Keep it to the name. No verbs about the reader's day, no orb, no percentage, no
  interpretation.

  Czech, for shape only — write the equivalent in the reader's language:
  "Tranzitní Venuše v trigonu k Venuši Anny", "Tranzitní Mars v kvadratuře k tvému Měsíci".

- aspects[].description:
  90 to 130 characters, in two parts.

  First, what this aspect is about between them, as a compressed phrase rather than a full
  sentence: "warmth that comes easily today", "his patience is shorter than usual". An
  abstract noun is allowed here — that is the register of a label.

  Then a REAL SENTENCE about today: a verb, and something the reader could actually do or
  notice. Not a slogan. "Be patient", "stay open" and "communicate honestly" are not
  recommendations, they are decoration, and they are what this field degrades into when
  nothing stops it.

  Do not give every aspect the same shape. If several in a row read as "abstract noun,
  semicolon, imperative", rewrite them. Never repeat the title, and never say what another
  aspect's description already said.

  Follow the explanation rules below: name what the planets do, never the angle between
  them. The angle belongs in the title and nowhere else.

Do not return markdown. Do not wrap the JSON inside code fences. Do not explain anything.
Return only the JSON object.

==================================================
ONE THEME, THEN ANGLES ON IT
==================================================

Before you write anything, decide what today is ABOUT for these two — one sentence, taken
from the strongest of the aspects above. Something like "you want to settle something and
${input.personB.name} is not in the mood to be pinned down."

That is the spine. Everything else is an angle on it: where it shows up, what gets in its
way, what to do about it. A paragraph that introduces a new subject instead of turning
that one over is the failure this rule exists for — cut it and write the missing angle
instead.

"overview.description" states the theme plainly. "deepInsight" develops it. They must be
the same idea, not two different readings of the day.

Open with the theme, in words the reader recognises from their own life. Then the friction:
what pushes back against it, and where they will actually notice it — in a message, in an
evening, in a conversation they keep putting off. Then one more angle, still on the same
theme. Close by turning it into a choice, not a summary and not encouragement.

Do not repeat ideas across sections. The overview, the long read, the opportunity, the
watch-out and the advice each have to carry something the others do not.

==================================================
HOW TO WRITE IT
==================================================

${VOICE_RULES}

--------------------------------------------------
THE EXPLANATION IN "aspects[].description"
--------------------------------------------------

${REASON_RULES}

These rules govern "aspects[].description" and every other field. "aspects[].title" is the
single exception and is bound by its own rule above: it is the aspect's name, so it names
the angle.

==================================================
ASTROLOGY VISIBILITY
==================================================

These fields must NEVER mention astrology, planets, aspects, conjunctions, trines,
sextiles, squares, oppositions or zodiac signs:

- overview.title
- overview.description
- deepInsight
- opportunity.description
- opportunity.examples
- watchOut.description
- watchOut.examples
- practicalAdvice

Two fields are exempt. "aspects[].title" is the aspect's name and must name the planets
and the angle. "aspects[].description" explains the astrological cause, under the rules
above: at most two planets, and say what they do together rather than listing them.

==================================================
RELATIONSHIP CONTEXT
==================================================

Relationship types:

- partner
- crush
- friend
- family
- coworker
- acquaintance

Adapt every section to the relationship type. What is at stake differs:

partner - intimacy, affection, quality time, shared decisions
crush - openness, curiosity, patience
friend - support, trust, shared experiences
family - respect, understanding, patience
coworker - communication, cooperation, professionalism
acquaintance - openness, politeness, building rapport

Never use romantic language unless the relationship type is "partner" or "crush".

Respond ONLY in:

${language}
`;
}

/* ============================================================
   GENERATE
============================================================ */

const MODEL = "gemini-2.5-flash";

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * Never throws on a bad answer: the caller logs every call, successful or not, so a
 * parse failure has to come back with its metrics attached.
 */
export async function generateCompatibilityInsight(
    languageIso: string,
    input: CompatibilityInsightInput
): Promise<{
    content: CompatibilityInsightContent | null;
    usage: {
        requestId: string;
        provider: string;
        model: string;
        input: string;
        output: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        latencyMs: number;
        cost: number;
        error: string | null;
    };
}> {
    const language = getLanguageByIso(languageIso);

    // Person A is the reader — the gendered forms and the profile are theirs.
    const prompt = buildPrompt(
        language ? buildPromptLanguageRule(language, input.reader.gender) : languageIso,
        buildReaderBlock(input.reader),
        input
    );

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
            temperature: 0.5,
            responseMimeType: "application/json",
            responseJsonSchema: toResponseJsonSchema(answerSchema),
        },
    });

    const text = response.text ?? "";

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    /**
     * Thinking tokens are billed at the output rate but are not part of
     * `candidatesTokenCount`, so leaving them out under-reported every generation by
     * 30–45 % while the default budget was on. Counted here so the audit row is what
     * was actually charged rather than what was visible.
     */
    const outputTokens =
        (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0);

    const usage = {
        requestId: response.responseId ?? "",
        provider: "google",
        model: MODEL,
        input: prompt,
        output: text,
        inputTokens,
        outputTokens,
        totalTokens: response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
        latencyMs: Date.now() - startedAt,
        cost:
            (inputTokens / 1_000_000) * PRICE_PER_MILLION.input + (outputTokens / 1_000_000) * PRICE_PER_MILLION.output,
        error: null as string | null,
    };

    const raw = parseLLMJson<unknown>(text);
    const parsed = raw === null ? null : answerSchema.safeParse(raw);

    if (!parsed?.success) {
        /**
         * `finishReason` alone does not explain a rejected answer — `STOP` means the
         * model finished cleanly and the fault is on this side of the wire. Say which of
         * the three it was, or the next failure costs another read of the raw output.
         */
        const issue = parsed?.error.issues[0];

        const reason = text.trim()
            ? issue
                ? `answer does not match the schema at "${issue.path.join(".")}": ${issue.message}`
                : "answer could not be parsed as JSON"
            : "model returned no text";

        return {
            content: null,
            usage: {
                ...usage,
                error: `${reason} (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}, ${text.length} chars)`,
            },
        };
    }

    const result = parsed.data;

    return {
        usage,
        content: {
            overview: result.overview,
            // Trimmed and emptied out here so no screen has to defend against a blank
            // paragraph the model padded the array with.
            deepInsight: result.deepInsight.map((paragraph) => paragraph.trim()).filter(Boolean),
            /**
             * Trimmed to four each because the schema cannot bound array length for the
             * decoder — a model that returns six chips would otherwise overflow the row
             * of them on the screen.
             */
            opportunity: {
                description: result.opportunity.description,
                examples: result.opportunity.examples.slice(0, 4),
            },
            watchOut: {
                description: result.watchOut.description,
                examples: result.watchOut.examples.slice(0, 4),
            },
            practicalAdvice: result.practicalAdvice,
            /**
             * Driven by the engine's list, not the model's: an aspect the model dropped,
             * duplicated or renamed still gets an entry, falling back to the English
             * caption rather than disappearing from the screen.
             */
            aspects: Object.fromEntries(
                input.contacts.map((contact) => {
                    const written = result.aspects.find((entry) => entry.id === contact.id);

                    return [
                        contact.id,
                        {
                            id: contact.id,
                            // The English name, not the English caption: a dropped entry
                            // has to fall back to the same kind of thing the field holds.
                            title: written?.title ?? contactLabel(contact, input.personB.name),
                            description: written?.description ?? contact.description,
                        },
                    ];
                })
            ),
        },
    };
}
