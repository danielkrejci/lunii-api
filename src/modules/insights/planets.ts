import { z } from "zod";

import { ai } from "../../lib/ai";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { getLLMJson, parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { Planet, PLANETS } from "../astro";
import { TransitChart } from "../astro/types";
import { PlanetInfluence as PlanetWeight } from "../dailyScore/types";
import { PLANET_PROFILES } from "./planetProfiles";
import { buildReaderBlock, Reader } from "./reader";
import { SIGN_PROFILES } from "./signProfiles";
import { VOICE_RULES } from "./voice";

const MODEL = "gemini-2.5-flash";

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * The AI-written half of the planetary panel.
 *
 * Split out of the daily horoscope because it is 83% of that generation's output and is
 * read only when someone opens a planet — most days nobody does, and the horoscope was
 * waiting a minute for text that would never be shown.
 */
export interface PlanetInsightContent {
    planets: {
        name: Planet;
        /**
         * The reading itself: what this body does for the reader today, and why.
         *
         * One text rather than a description and a separate reason, the same way the Moon
         * screen does it — split in two they read as the same thing said twice, and the
         * two fields together were most of the output for every body on every day.
         * One entry per paragraph.
         */
        insight: string[];
        /**
         * Keyed by contact id rather than positional: the wording was written for one
         * day's aspects, and a contact that has moved on must simply have no wording.
         *
         * `title` is the aspect's astrological name in the reader's language ("Tranzitní
         * Saturn v kvadratuře k natálnímu Měsíci") — a name, not an interpretation. What
         * it MEANS is `description`.
         */
        aspects: Record<string, { id: string; title: string; description?: string }>;
    }[];
}

/**
 * What the reader has already read in today's horoscope, when it is written.
 *
 * Best-effort: the panel renders from the deterministic half the moment the screen opens,
 * so someone can tap into a planet while the horoscope is still generating. A missing
 * teaser drops the block rather than making this wait — waiting would tie two lifecycles
 * together and freeze the panel whenever the horoscope failed.
 */
export interface DailyTeaser {
    overview: { title: string; description: string };
    deepInsight: string[];
    opportunity: { description: string };
    watchOut: { description: string };
}

const answerSchema = z.object({
    planets: z.array(
        z.object({
            name: z.enum(PLANETS),
            /**
             * One entry per paragraph. Asked for as a single string with blank lines in
             * it, the decoder returns one unbroken paragraph — see the Moon prompt.
             */
            insight: z.array(z.string()),
            contacts: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() })),
        })
    ),
});

/* ============================================================
   PROMPT
============================================================ */

function buildBodies(planets: PlanetWeight[], transits: TransitChart): string {
    return planets
        .map((planet) => {
            const profile = PLANET_PROFILES[planet.name];
            /**
             * Where the body stands today. Without it the model had nothing to say about
             * the planet itself and wrote about the bodies it touches instead.
             */
            const position = transits[planet.name];
            const motion =
                position.retrograde === undefined ? "" : position.retrograde ? ", retrograde" : ", moving direct";

            const contacts =
                planet.contacts.length > 0
                    ? planet.contacts
                          .map(
                              (contact) =>
                                  `  - id: ${contact.id} | ${contact.reason} | "${
                                      contact.title
                                  }" | orb ${contact.orb.toFixed(1)}°, exactness ${Math.round(
                                      contact.strength * 100
                                  )}%, ${contact.value >= 0 ? "supportive" : "difficult"}`
                          )
                          .join("\n")
                    : "  - none — this body makes no contact with the chart today";

            return `
${profile.displayName} (id: ${planet.name})
Weight today: ${planet.score}/100, from ${planet.aspects} aspect${planet.aspects === 1 ? "" : "s"}
Today it stands in: ${position.sign}${motion}
Qualities that sign lends it: ${SIGN_PROFILES[position.sign].keywords.join(", ")}
Meaning: ${profile.description}
Keywords: ${profile.keywords.join(", ")}
Today's contacts:
${contacts}`;
        })
        .join("\n");
}

export function buildPrompt(input: {
    planets: PlanetWeight[];
    transits: TransitChart;
    readerBlock: string;
    teaser: DailyTeaser | null;
    language: string;
}): string {
    const teaserBlock = input.teaser
        ? `
==================================================
WHAT THE READER HAS ALREADY READ TODAY
==================================================

Their horoscope for today says:

"${input.teaser.overview.description}"

${input.teaser.deepInsight.join("\n\n")}

It also suggested: ${input.teaser.opportunity.description}
And warned about: ${input.teaser.watchOut.description}

Continue from this. Each body has to say something the horoscope did not — go deeper into
what that one planet is doing, rather than restating the day in ten variations. Never
contradict it.
`
        : "";

    return `==================================================
LANGUAGE AND FORM OF ADDRESS
==================================================

${input.language}

This governs every field you return. It is repeated at the end; check it again before you
answer.

==================================================
ROLE
==================================================

You write the planetary panel of a personal astrology app.

The reader has opened one planet from today's horoscope. They already see its name, how
strongly it is working today and which contacts it makes to their chart. Your job is the
part they cannot see: what it means for them.

==================================================
HOW TO WRITE IT
==================================================

${VOICE_RULES}

Name the planets and the sign, never the geometry. The body's sign and the reader's
planets it touches are what the reader came to learn, so name them plainly. Say what the
contact does in plain words — a planet can be "pressing on", "supporting", "pulling
against" or "pulling in the same direction as" one of theirs. Never name the angle
itself: no oppositions, squares, conjunctions, trines or sextiles, and no "natal", no
houses, no Ascendant — the contact's exact name sits right below the text already.

"planets[].contacts[].title" is the single exception in the whole answer: it is the
aspect's name, so it names the angle. Nothing else does.

==================================================
TODAY'S PLANETS
==================================================

Each body carries a score from 0–100 describing how active it is TODAY in this chart.
The score measures importance, not positivity. A high score means strong influence,
not a good day. A score near zero means the body is largely inactive today.

Never mention the score. Never mention numbers.

Every contact carries an orb and an exactness percentage. Exactness describes how
precisely the contact lands today:

High exactness (roughly 80–100%) means the influence is at its peak right now. Write
about it as something clearly present today.

Medium exactness (roughly 40–80%) means it is building or fading. Write about it as a
background influence rather than the main event.

Low exactness (below roughly 40%) means it is barely in effect. Mention it only if
nothing else is happening for that body.

When one body has several contacts, let the most exact one lead the insight, and
use the others only where they genuinely change the picture. Never state the orb or
the percentage — translate them into how present the influence feels.

Each contact is listed as:

  id | English label | "English title" | orb, exactness, direction

In every contact the body under which it is listed is the one MOVING today ("Transit");
the other is a fixed point in the reader's birth chart ("Natal"). "Transit Mars square
Natal Venus" means Mars is pressing on the reader's own Venus — Mars acts, their Venus is
what gets touched. Never turn it around and write as if the natal planet were acting.

${buildBodies(input.planets, input.transits)}
${teaserBlock}
${input.readerBlock}

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

{
    "planets": [
        {
            "name": "sun",
            "insight": [
                "string",
                "string"
            ],
            "contacts": [
                {
                    "id": "string",
                    "title": "string",
                    "description": "string"
                }
            ]
        }
    ]
}

- planets:
  Exactly one object for every planet listed under TODAY'S PLANETS, in the same order.
  Use the exact id as "name". Never return the score, the orb or the exactness.
  Never invent contacts: return exactly the ones listed for that body, in the same
  order, and copy each "id" character for character. A body with no contacts gets an
  empty "contacts" array.

- planets[].insight:
  The whole reading for that body, as 2–3 paragraphs — ONE PARAGRAPH PER ARRAY ENTRY.
  Never put a line break inside an entry and never return the whole reading as a single
  entry. Together the entries run at most 750 characters, about TODAY only.

  Build it as a movement, not as labelled sections. Never write a heading, a bullet or
  a label, and never announce the structure ("here is why", "the reason is").

  The text is about THIS body. Name it in the first sentence and keep it the subject of
  the whole reading — the reader opened Mars to read about Mars. The other planets
  appear only as what this one is touching.

  First paragraph: where the body is now and what that means. Name the sign it stands
  in, and say whether it is retrograde when it is. Then what that sign does to this
  planet's theme today — how its drive, voice, warmth or pressure shows up in everyday
  life.

  Second paragraph: what it touches in the reader's chart. Name the strongest contact
  or two: which of THEIR planets it reaches ("your Venus", "your own Moon"), whether it
  supports or presses on it, and what that changes for them today — concrete, something
  they will notice. A body with no contacts today gets this paragraph about why it is
  quiet and what that leaves room for.

  An optional third paragraph closes on what to do with it. Leave it out rather than
  repeat yourself.

  Never write a heading, a bullet or a label, and never announce the structure ("here is
  why", "the reason is"). Each paragraph must carry the text further — one that restates
  the previous in other words is a failure.

- planets[].contacts[].title:
  The aspect's NAME, translated: the second field of its line, the one that reads
  "Transit <planet> <aspect> Natal <planet>".

  Name both planets and the angle between them, in the reader's language, using the
  ordinary name of each body as the naming rule above requires. This is the ONE field
  that says the
  geometry out loud — everything else in this answer hides it. Never replace it with a
  mood, a theme or a poetic caption, and never translate the title in quotes instead:
  that title is what the aspect MEANS, and its place is the description.

  Keep it to the name. No verbs about the reader's day, no orb, no percentage, no
  interpretation.

  Czech, for shape only — write the equivalent in the reader's language:
  "Tranzitní Saturn v kvadratuře k natálnímu Měsíci", "Tranzitní Venuše v trigonu k
  natálnímu Slunci".

- planets[].contacts[].description:
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
  The angle belongs in the title and nowhere else.

Do not return markdown.

Do not wrap the JSON inside code fences.

Do not explain anything.

Return only the JSON object.

Respond only in:
${input.language}`;
}

/* ============================================================
   GENERATE
============================================================ */

/**
 * Writes the planetary panel. Never throws on a bad answer — the caller logs every call,
 * successful or not, so a parse failure has to come back with its metrics attached.
 */
export async function generatePlanetInsights(input: {
    /** Per-body weights from the engine. The model interprets them, never rescores them. */
    planets: PlanetWeight[];
    /** Where each body stands today: its sign and whether it is retrograde. */
    transits: TransitChart;
    reader: Reader;
    /** Today's horoscope, or null when it is not written yet. */
    teaser: DailyTeaser | null;
    languageIso: string;
}): Promise<{
    content: PlanetInsightContent | null;
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
    const { prompt, config } = buildPlanetInsightsRequest(input);

    const startedAt = Date.now();

    const response = await ai.models.generateContent({ model: MODEL, contents: prompt, config });

    const text = response.text ?? "";

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;

    /** Thinking tokens bill at the output rate but sit outside `candidatesTokenCount`. */
    const outputTokens =
        (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0);

    const usage = {
        requestId: response.responseId ?? "",
        provider: "google",
        model: MODEL,
        input: prompt,
        output: text as string | null,
        inputTokens,
        outputTokens,
        totalTokens: response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
        latencyMs: Date.now() - startedAt,
        cost:
            (inputTokens / 1_000_000) * PRICE_PER_MILLION.input + (outputTokens / 1_000_000) * PRICE_PER_MILLION.output,
        error: null as string | null,
    };

    const read = readPlanetInsightsAnswer(text, input.planets, response.candidates?.[0]?.finishReason);

    return {
        content: read.content,
        usage: { ...usage, output: getLLMJson(text), error: read.error },
    };
}

/**
 * Everything a call needs, assembled without making one. Shared by the interactive path
 * and the nightly batch so the two cannot drift apart.
 */
export function buildPlanetInsightsRequest(input: {
    planets: PlanetWeight[];
    transits: TransitChart;
    reader: Reader;
    teaser: DailyTeaser | null;
    languageIso: string;
}): { prompt: string; config: Record<string, unknown> } {
    const language = getLanguageByIso(input.languageIso);

    const prompt = buildPrompt({
        planets: input.planets,
        transits: input.transits,
        // The panel is about the chart's bodies, so the placements the reader block names
        // come from the contacts on show rather than from the day's strongest impacts.
        readerBlock: buildReaderBlock(
            input.reader,
            input.planets.flatMap((planet) => planet.contacts)
        ),
        teaser: input.teaser,
        language: language ? buildPromptLanguageRule(language, input.reader.gender) : input.languageIso,
    });

    return {
        prompt,
        config: {
            /** See the note in modules/insights — thinking bought nothing but latency. */
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
            responseJsonSchema: toResponseJsonSchema(answerSchema),
        },
    };
}

/**
 * Turns whatever the model said into a panel, or explains why it could not.
 *
 * Takes the engine's weights as well as the text: the answer is keyed against them, so a
 * body the model dropped or renamed still gets an entry rather than vanishing.
 */
export function readPlanetInsightsAnswer(
    text: string,
    planets: PlanetWeight[],
    finishReason?: string
): { content: PlanetInsightContent | null; error: string | null } {
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
            error: `${reason} (finishReason: ${finishReason ?? "unknown"}, ${text.length} chars)`,
        };
    }

    return {
        error: null,
        content: {
            /**
             * Driven by the engine's list, not the model's: a body or contact the model
             * dropped, duplicated or renamed still gets an entry, falling back to the
             * English wording rather than disappearing from the panel.
             */
            planets: planets.map((planet) => {
                const written = parsed.data.planets.find((entry) => entry.name === planet.name);

                return {
                    name: planet.name,
                    insight: written?.insight ?? [PLANET_PROFILES[planet.name].description],
                    aspects: Object.fromEntries(
                        planet.contacts.map((contact) => {
                            const wording = written?.contacts?.find((entry) => entry.id === contact.id);

                            return [
                                contact.id,
                                {
                                    id: contact.id,
                                    // The English name, not the English caption: a
                                    // dropped entry has to fall back to the same kind of
                                    // thing the field holds.
                                    title: wording?.title ?? contact.reason,
                                    description: wording?.description ?? contact.description,
                                },
                            ];
                        })
                    ),
                };
            }),
        },
    };
}
