import dayjs from "dayjs";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { profile as profileTable } from "../db/schema";
import { buildDayContext } from "../modules/chat/context";
import { buildHistory, HISTORY_FETCH_LIMIT, MAX_CHARS, MAX_TURNS } from "../modules/chat/history";
import { buildChatSystemPrompt, buildClosingLanguageRule } from "../modules/chat/prompt";

/**
 * Prints the whole request the chat would send, for a real profile on a real day.
 *
 * This is the cheapest way to judge the feature: the prompt is what decides whether the
 * answers are any good, and reading it costs nothing next to iterating through a route
 * and a model call.
 *
 *   pnpm tsx src/scripts/printChatPrompt.ts
 *   pnpm tsx src/scripts/printChatPrompt.ts --user <id> --date 2026-09-01
 *   pnpm tsx src/scripts/printChatPrompt.ts --ask "What does my Venus placement mean?"
 */

function arg(name: string, fallback?: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

/**
 * Rough, and enough. Gemini bills what its own tokenizer counts; four characters per
 * token is the usual approximation for prose and is here to answer "is this the right
 * order of magnitude", not to be a bill.
 */
function tokens(text: string): number {
    return Math.round(text.length / 4);
}

/** The list price this repo already logs against, from modules/insights. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

function rule(title: string) {
    console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n`);
}

async function main() {
    const date = dayjs(arg("date", dayjs().format("YYYY-MM-DD"))).format("YYYY-MM-DD");
    const question = arg("ask", "Why is my love energy so low today?")!;
    const userId = arg("user");

    const [profile] = userId
        ? await db.select().from(profileTable).where(eq(profileTable.userId, userId)).limit(1)
        : await db.select().from(profileTable).limit(1);

    if (!profile) {
        console.error(userId ? `No profile for user ${userId}` : "No profiles in the database.");
        process.exit(1);
    }

    console.log(`profile  ${profile.name} (${profile.userId})`);
    console.log(`language ${profile.language}, ${profile.gender}, ${profile.timezone}`);
    console.log(`born     ${profile.birthDate} ${profile.birthTime ?? "(no time)"} in ${profile.birthPlace}`);
    console.log(`date     ${date}`);
    console.log(`question ${question}`);

    // The stored row satisfies `Reader` structurally, which is the arrangement every
    // other generator here uses — nothing has to be picked apart and kept in sync.
    const system = buildChatSystemPrompt({ reader: profile, languageIso: profile.language });

    const dayContext = await buildDayContext(db, { userId: profile.userId, profile, date });
    const closing = buildClosingLanguageRule({ reader: profile, languageIso: profile.language });

    /**
     * A thread with one exchange behind it, so the transcript shows what a follow-up
     * actually looks like — the case the window exists for.
     */
    const { contents, kept, carriedOpening } = buildHistory({
        messages: [
            { order: 1, role: "user", content: "What should I focus on today?", status: "ready" },
            {
                order: 2,
                role: "assistant",
                content: "Mars is pushing you to start things before they are ready.",
                status: "ready",
            },
            { order: 3, role: "user", content: question, status: "ready" },
            { order: 4, role: "assistant", content: "", status: "streaming" },
        ],
        dayContext,
        closing,
    });

    rule("systemInstruction");
    console.log(system);

    rule("contents");
    for (const content of contents) {
        console.log(`--- ${content.role} ---`);
        console.log(content.parts?.[0]?.text ?? "");
        console.log();
    }

    const transcript = contents.map((content) => content.parts?.[0]?.text ?? "").join("\n");

    const inputTokens = tokens(system) + tokens(transcript);
    // What a two-to-three paragraph answer runs to, for the cost line below.
    const outputTokens = 600;

    rule("budget");
    console.log(`system instruction   ${tokens(system).toString().padStart(6)} tokens  (cached after turn one)`);
    console.log(`  voice + chat rules, the reader, the whole chart`);
    console.log(`day context          ${tokens(dayContext).toString().padStart(6)} tokens  (rides on this turn)`);
    console.log(
        `transcript           ${(tokens(transcript) - tokens(dayContext)).toString().padStart(6)} tokens  (${kept} kept, window ${MAX_TURNS}/${MAX_CHARS}, fetch ${HISTORY_FETCH_LIMIT}${carriedOpening ? ", opening carried" : ""})`
    );
    console.log("-".repeat(52));
    console.log(`input                ${inputTokens.toString().padStart(6)} tokens`);
    console.log(`output (assumed)     ${outputTokens.toString().padStart(6)} tokens`);

    const cost =
        (inputTokens / 1_000_000) * PRICE_PER_MILLION.input + (outputTokens / 1_000_000) * PRICE_PER_MILLION.output;

    console.log(`\ncost per turn        $${cost.toFixed(5)}   ($${(cost * 40).toFixed(3)} at the 40/hour ceiling)`);
    console.log();

    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
