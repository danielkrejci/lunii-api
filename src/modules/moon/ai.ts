import { z } from "zod";

import { ai } from "../../lib/ai";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { ZodiacSign } from "../../utils/natalUtils";
import { getLLMJson, parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { PlanetContact } from "../dailyScore/types";
import { MOON_PHASE_INFLUENCE, MOON_PHASE_LABEL, MOON_SIGN_INFLUENCE } from "../insights";
import { buildReaderBlock, Reader } from "../insights/reader";
import { SIGN_PROFILES } from "../insights/signProfiles";
import { VOICE_RULES } from "../insights/voice";
import { MoonToday, MoonVariant } from "./today";

const MODEL = "gemini-2.5-flash";

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/** The whole AI-written half of the Moon Today screen. */
export interface MoonInsightContent {
    /**
     * The reading itself: what today's Moon is like for this reader, and why.
     *
     * One text rather than a description and a separate reason — the two were always
     * about the same thing, and split in two they read as the same sentence said twice.
     * Paragraphs are separated by a blank line; the client renders them as such.
     */
    insight: string[];
    /**
     * One caption per lunar aspect, in the reader's language.
     *
     * Keyed by contact id rather than positional: the wording was written for one day's
     * aspects, and a contact that has moved on must simply have no wording.
     *
     * Optional because rows written before captions existed do not carry it.
     */
    contacts?: Record<string, MoonContactText>;
    /**
     * What today's Moon is and is not good for, as scannable chips rather than prose.
     *
     * Deliberately keyword-only: the daily horoscope already writes an `opportunity` and
     * a `watchOut` for the whole day, and a second prose recommendation from a separate
     * generation would sooner or later contradict it on the same screen.
     *
     * Optional for the same reason as `contacts` — earlier rows do not carry it.
     */
    activities?: MoonActivities;
}

export interface MoonContactText {
    id: string;
    title: string;
    /** What this contact does and what to do with it. Absent on older rows. */
    description?: string;
}

export interface MoonActivities {
    /** Four expressions of 1–3 words each. */
    supported: string[];
    avoid: string[];
}

const answerSchema = z.object({
    /**
     * One entry per paragraph, joined into `MoonInsightContent.insight` below.
     *
     * Asked for as a single string with blank lines in it, the decoder returned one
     * unbroken paragraph — the array is the only way the structure reliably survives.
     */
    insight: z.array(z.string()),
    /** An array on the wire, turned into a record below — models count badly on objects. */
    contacts: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() })),
    activities: z.object({ supported: z.array(z.string()), avoid: z.array(z.string()) }),
});

/**
 * What the reader has already seen in today's daily horoscope, when it is written.
 *
 * Carried so the Moon screen can build on it instead of repeating it. Every field is
 * best-effort: the daily horoscope has its own lifecycle and may be pending or failed.
 */
export interface MoonTeaser {
    /** The horoscope's whole Moon note — one text, what it is like and why. */
    insight: string;
    /** The horoscope's four supported and four discouraged activities for the whole day. */
    opportunities?: string[];
    watchOuts?: string[];
}

/* ============================================================
   PROMPT
============================================================ */

/**
 * What each variant is actually about.
 *
 * A Full Moon and an ordinary Waxing Gibbous are not the same event described with more
 * emphasis — they are different things to say, which is why the client gives them
 * different layouts and why they get different instructions here rather than one prompt
 * with an adjective swapped.
 */
const VARIANT_BRIEF: Record<MoonVariant, string> = {
    generic: `Today is an ordinary day in the lunar cycle.

Describe how the current Moon sign and phase colour the reader's day.

Stay close to the everyday: mood, energy, what feels easy and what feels effortful.

Do not treat the day as an event. It is a texture, not a turning point.`,

    fullMoon: `Today the Moon is FULL — the exact moment falls on this calendar day.

This is a peak, not a phase. Write about culmination: what has been building becomes
visible, feelings run closer to the surface, something that was unclear resolves.

Say what is coming to light for THIS reader, based on where the Full Moon lands in
their chart. Avoid the clichés of "release" and "letting go" unless their chart
genuinely points there.`,

    newMoon: `Today is the NEW MOON — the exact moment falls on this calendar day.

This is the start of a cycle. Write about beginnings: intentions, the quiet before
momentum, choosing a direction while nothing is visible yet.

The New Moon is dark. Nothing is obvious yet, and the text should feel like that —
open and unhurried, not triumphant. Ground the beginning in where it lands in THIS
reader's chart.`,
};

function buildLunarContacts(contacts: PlanetContact[]): string {
    if (contacts.length === 0) {
        return "The Moon makes no notable aspect to the natal chart today.";
    }

    /**
     * The id and the English caption are here because the model has to echo one back and
     * translate the other. Orb and exactness let it tell an aspect 0.2° from exact apart
     * from one about to leave orb — flattened to text they read identically.
     */
    return contacts
        .map(
            (contact) =>
                `- id: ${contact.id} | ${contact.reason} | "${contact.title}" | orb ${contact.orb.toFixed(1)}°, exactness ${Math.round(contact.strength * 100)}%, ${contact.value >= 0 ? "supportive" : "difficult"}`
        )
        .join("\n");
}

function buildPrompt(input: {
    variant: MoonVariant;
    moon: MoonToday;
    contacts: PlanetContact[];
    teaser: MoonTeaser | null;
    language: string;
    natalMoonSign: string;
    /** The one description of the reader every prompt shares. */
    readerBlock: string;
}): string {
    const { moon } = input;

    const phaseLabel = MOON_PHASE_LABEL[moon.phase];

    /**
     * Only present when the daily horoscope for this day is already written. It may be
     * pending or failed — Moon Today never waits for it — so the whole block drops out
     * rather than the prompt referring to something that is not there.
     */
    const teaserBlock = input.teaser
        ? `
==================================================
WHAT THE READER HAS ALREADY BEEN TOLD TODAY
==================================================

Their daily horoscope already carries this short note about the Moon:

"${input.teaser.insight}"

Continue from it. Go deeper and be more specific — do not restate it, and do not
contradict it.
${
    input.teaser.opportunities?.length || input.teaser.watchOuts?.length
        ? `
The same horoscope already suggested these for the day as a whole:

Supported: ${input.teaser.opportunities?.join(", ") || "none"}
Discouraged: ${input.teaser.watchOuts?.join(", ") || "none"}

Do not repeat those words verbatim. You may build on them — the Moon is part of the
same day and the same chart, so narrowing one of them to something specifically lunar
is better than inventing an unrelated direction. Never contradict them.
`
        : ""
}`
        : "";

    return `
==================================================
LANGUAGE AND FORM OF ADDRESS
==================================================

${input.language}

This governs every field you return. It is repeated at the end; check it again before you
answer.

==================================================
ROLE
==================================================

You write the Moon section of a personal astrology app.

The reader opens a screen dedicated to today's Moon. They already see the sign, the
phase, how much of the disc is lit, and when the next Full and New Moon fall. Your job
is the part they cannot see: what it means for them.

==================================================
TODAY'S MOON
==================================================

Moon sign:

${moon.sign}

Moon phase:

${phaseLabel}

Illumination:

${moon.illumination}%

What this sign tends to bring:

${MOON_SIGN_INFLUENCE[moon.sign]}

What this phase tends to bring:

${MOON_PHASE_INFLUENCE[moon.phase]}

Qualities this sign lends the day:

${SIGN_PROFILES[moon.sign].keywords.join(", ")}

These describe the colour of the day while the Moon stands here. They are NOT a
description of the reader's character.

==================================================
THIS DAY
==================================================

${VARIANT_BRIEF[input.variant]}

==================================================
THE MOON IN THIS READER'S CHART
==================================================

These are the aspects today's Moon makes to their natal chart. They are the reason this
text is about THEM and not about everyone.

${buildLunarContacts(input.contacts)}

Use them as the mechanism behind what you describe. Never name them as jargon — the
reader should recognise the experience, not the aspect.
${teaserBlock}
${input.readerBlock}

Their own Moon sits in ${input.natalMoonSign}, which is how they normally handle feeling:

${MOON_SIGN_INFLUENCE[input.natalMoonSign as ZodiacSign]}

Today's Moon is somewhere else. The distance between how they normally process things and
what today's Moon asks for is the most interesting thing you can write about — use it when
the two genuinely differ, and say nothing about it when they do not.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

{
    "insight": [
        "string",
        "string"
    ],
    "contacts": [
        {
            "id": "string",
            "title": "string"
        }
    ],
    "activities": {
        "supported": ["string", "string", "string", "string"],
        "avoid": ["string", "string", "string", "string"]
    }
}

- insight:
  The whole reading, as 2–3 paragraphs — ONE PARAGRAPH PER ARRAY ENTRY. Never put a
  line break inside an entry and never return the whole reading as a single entry.
  Together the entries run 2–4 sentences and at most 900 characters.

  Build it as a movement, not as labelled sections. Never write a heading, a bullet or
  a label, and never announce the structure ("here is why", "the reason is").

  Open with what today is likely to FEEL like for this reader — concrete and everyday,
  mood, energy, what comes easily and what drags. Then let it turn to WHY: the Moon's
  sign, its phase and the aspects it makes today, in plain words and without
  astrological jargon. Close on how that lands for them.

  Each paragraph must carry the text further. A second paragraph that restates the
  first in other words is a failure — the reader has to learn something new from it.

- contacts:
  Exactly one object for every aspect listed under THE MOON IN THIS READER'S CHART, in
  the same order, copying each "id" character for character. Never invent one and never
  drop one. If no aspects are listed there, return an empty array.

- contacts[].title:
  Translate the English caption in quotes. It is a label shown next to the numbers, not
  prose: a short headline, never longer than the original and never a sentence.

- contacts[].description:
  90 to 130 characters, in two parts.

  First, what this contact is about, as a compressed phrase rather than a full sentence:
  "tension between action and restriction", "easy warmth in conversation". An abstract
  noun is allowed here — that is the register of a label.

  Then a REAL SENTENCE about today: a verb, and something the reader could actually do or
  notice. Not a slogan. "Trust your insights", "be patient", "let the ideas flow" and
  "find a healthy outlet" are not recommendations, they are decoration, and they are what
  this field degrades into when nothing stops it.

    Good: "Tension between action and restriction. Today it is better to slow down than
    to force a decision through."

    Bad: "Inner conflict; find a healthy way to let off steam."

  The bad one is half the length it should be, and its second half would fit under any
  aspect on any day.

  Do not give every contact the same shape. If several in a row read as "abstract noun,
  semicolon, imperative", rewrite them. Never repeat the title, and never say what another
  contact's description already said.

  Follow the explanation rules: name what the planets do, never the angle between them.

- activities:
  Exactly 4 entries in each array, each 1–3 words. These are chips on a screen, not
  sentences, and not a repeat of what you wrote above.

  Derive them from the three things that make today specific: the Moon's SIGN, its
  PHASE, and the ASPECTS listed above. Let the supportive aspects and what the sign and
  phase favour drive "supported"; let the difficult aspects and what they strain drive
  "avoid".

  Name ACTIVITIES AND SITUATIONS, not feelings or qualities. "Deep conversations" is
  right; "Emotional depth" is not. "Decluttering", "Journaling", "Reaching out",
  "Rushing decisions", "Big purchases", "Crowded plans" are the register.

  Never reuse a word you already used in "insight".

  Do not hedge: "avoid" names things genuinely worth postponing today, not vague
  cautions that would be true on any day, or for any reader.

==================================================
HOW TO WRITE IT
==================================================

${VOICE_RULES}

Two rules on top of those, for this screen:

Never name the aspects as jargon in "insight" — the reader should recognise the
experience, not the geometry. The captions and the chips are labels, not prose.

If the sign, the phase and the aspects pull in different directions, write a believable
balance instead of ignoring any of them.

Respond only in:
Respond only in:
${input.language}
`;
}

/* ============================================================
   GENERATE
============================================================ */

/**
 * Writes the Moon Today text. Never throws on a bad answer — the caller logs every call,
 * successful or not, so a parse failure has to come back with its metrics attached.
 */
export async function generateMoonInsight(input: {
    variant: MoonVariant;
    moon: MoonToday;
    /** Today's transit-Moon → natal contacts, strongest first. */
    contacts: PlanetContact[];
    /** The daily horoscope's moon teaser, or null when it is not written yet. */
    teaser: MoonTeaser | null;
    languageIso: string;
    /** The whole reader. Their natal Moon grounds the reading, the rest shapes it. */
    reader: Reader;
    natalMoonSign: string;
}): Promise<{
    content: MoonInsightContent | null;
    usage: {
        requestId: string;
        provider: string;
        model: string;
        input: string;
        output: string | null;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        latencyMs: number;
        cost: number;
        error: string | null;
    };
}> {
    const language = getLanguageByIso(input.languageIso);

    const prompt = buildPrompt({
        variant: input.variant,
        moon: input.moon,
        contacts: input.contacts,
        teaser: input.teaser,
        language: language ? buildPromptLanguageRule(language, input.reader.gender) : input.languageIso,
        natalMoonSign: input.natalMoonSign,
        readerBlock: buildReaderBlock(input.reader, input.contacts),
    });

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
                output: getLLMJson(text),
                error: `${reason} (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}, ${text.length} chars)`,
            },
        };
    }

    return {
        usage: { ...usage, output: getLLMJson(text) },
        content: {
            insight: parsed.data.insight,
            /**
             * Driven by the engine's list, not the model's: a contact the model dropped,
             * duplicated or renamed still gets an entry, falling back to the English
             * caption rather than disappearing from the screen.
             */
            contacts: Object.fromEntries(
                input.contacts.map((contact) => [
                    contact.id,
                    {
                        id: contact.id,
                        title: parsed.data.contacts.find((entry) => entry.id === contact.id)?.title ?? contact.title,
                        description:
                            parsed.data.contacts.find((entry) => entry.id === contact.id)?.description ??
                            contact.description,
                    },
                ])
            ),
            /**
             * Trimmed to four each because the schema cannot bound array length for the
             * decoder — a model that returns six chips would otherwise overflow the row
             * of them on the screen.
             */
            activities: {
                supported: parsed.data.activities.supported.slice(0, 4),
                avoid: parsed.data.activities.avoid.slice(0, 4),
            },
        },
    };
}
