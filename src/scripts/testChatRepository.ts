import { eq } from "drizzle-orm";

import { db } from "../db";
import { chatConversations, chatMessages, user as userTable } from "../db/schema";
import {
    claimRetry,
    decodeConversationCursor,
    encodeConversationCursor,
    completeMessage,
    failMessage,
    getConversation,
    getRecentMessages,
    hasActiveStream,
    listConversations,
    listMessages,
    softDeleteConversation,
    startTurn,
    writePartialContent,
} from "../modules/chat/service";

/**
 * Exercises the chat repository against the real database.
 *
 * Only what needs one: the pure half lives in modules/chat/service.test.ts and runs
 * in `pnpm test` without any of this.
 *
 * Everything it creates it removes: the conversation is hard-deleted at the end, and
 * the messages cascade with it. Nothing existing is written to — the only row read
 * from outside its own data is a user id to hang the thread off.
 *
 *   pnpm tsx src/scripts/testChatRepository.ts
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok    ${label}`);
    } else {
        failures++;
        console.error(`  FAIL  ${label}`, detail === undefined ? "" : detail);
    }
}

async function main() {
    /* ---------- fixtures ---------- */

    const [owner, other] = await db.select({ id: userTable.id }).from(userTable).limit(2);

    if (!owner || !other) {
        console.error("\nNeeds at least two users in the database to check isolation.");
        process.exit(1);
    }

    console.log(`\nowner ${owner.id}\nother ${other.id}`);

    let conversationId: string | null = null;

    try {
        /* ---------- opening a thread ---------- */

        console.log("\nstartTurn");

        const first = await startTurn(db, {
            userId: owner.id,
            conversationId: null,
            content: "Why is my love energy low today?",
            clientId: crypto.randomUUID(),
        });

        check("a new thread is created", first !== null);

        if (!first) {
            throw new Error("startTurn returned null for a new conversation");
        }

        conversationId = first.conversationId;

        check("title comes from the message", first.title === "Why is my love energy low today?");
        check("the reader's message is first", first.userMessage.order === 1);
        check("the answer follows it", first.assistantMessage.order === 2);
        check("the answer starts streaming", first.assistantMessage.status === "streaming");
        check("the claim is millisecond-precise", first.assistantMessage.claimedAt.getMilliseconds() >= 0);
        check("not a resumed send", first.resumed === false);

        /* ---------- idempotency ---------- */

        console.log("\nidempotency");

        const clientId = crypto.randomUUID();

        const original = await startTurn(db, {
            userId: owner.id,
            conversationId,
            content: "And what about my career?",
            clientId,
        });

        const repeat = await startTurn(db, {
            userId: owner.id,
            conversationId,
            content: "And what about my career?",
            clientId,
        });

        check("a repeated send attaches instead of writing again", repeat?.resumed === true);
        check("it attaches to the same question", repeat?.userMessage.id === original?.userMessage.id);
        check("and to the same answer", repeat?.assistantMessage.id === original?.assistantMessage.id);

        /* ---------- ownership ---------- */

        console.log("\nownership");

        const stranger = await startTurn(db, {
            userId: other.id,
            conversationId,
            content: "Let me into someone else's thread",
            clientId: crypto.randomUUID(),
        });

        check("another reader cannot write into the thread", stranger === null);
        check("another reader cannot read the thread", (await getConversation(db, other.id, conversationId)) === null);
        check("the owner can", (await getConversation(db, owner.id, conversationId)) !== null);
        check(
            "another reader sees none of the messages",
            (await listMessages(db, other.id, conversationId, { limit: 50 })).length === 0
        );

        /* ---------- the streaming lifecycle ---------- */

        console.log("\nstreaming lifecycle");

        check("a live stream is visible to the guard", (await hasActiveStream(db, owner.id)) === true);
        check("and only to its own reader", (await hasActiveStream(db, other.id)) === false);

        const rolled = await writePartialContent(db, {
            messageId: first.assistantMessage.id,
            claimedAt: first.assistantMessage.claimedAt,
            content: "Venus is ",
        });

        check("a partial write lands", rolled !== null);
        check("and moves the claim forward", rolled?.getTime() !== first.assistantMessage.claimedAt.getTime());

        const stale = await writePartialContent(db, {
            messageId: first.assistantMessage.id,
            claimedAt: first.assistantMessage.claimedAt,
            content: "written with a claim that has moved on",
        });

        check("a stale claim writes nothing", stale === null);

        check(
            "the answer completes",
            (await completeMessage(db, {
                messageId: first.assistantMessage.id,
                claimedAt: rolled!,
                content: "Venus is under pressure from Saturn today.",
            })) === true
        );

        // Still true: the second turn opened above is streaming.
        check("the guard tracks the reader, not one message", (await hasActiveStream(db, owner.id)) === true);

        /* ---------- failure and retry ---------- */

        console.log("\nfailure and retry");

        check(
            "a failure keeps the partial text",
            (await failMessage(db, {
                messageId: original!.assistantMessage.id,
                claimedAt: original!.assistantMessage.claimedAt,
                errorCode: "generation_failed",
                content: "Saturn is",
            })) !== null
        );

        check("nothing is streaming any more", (await hasActiveStream(db, owner.id)) === false);

        const retried = await claimRetry(db, {
            userId: owner.id,
            conversationId,
            messageId: original!.assistantMessage.id,
            chargeKey: crypto.randomUUID(),
        });

        check("a failed answer can be retried", retried !== null);

        const retriedTwice = await claimRetry(db, {
            userId: owner.id,
            conversationId,
            messageId: original!.assistantMessage.id,
            chargeKey: crypto.randomUUID(),
        });

        check("but only once — the second claim finds nothing", retriedTwice === null);

        const strangerRetry = await claimRetry(db, {
            userId: other.id,
            conversationId,
            messageId: original!.assistantMessage.id,
            chargeKey: crypto.randomUUID(),
        });

        check("and never by another reader", strangerRetry === null);

        await completeMessage(db, {
            messageId: original!.assistantMessage.id,
            claimedAt: retried!.claimedAt,
            content: "Saturn is asking for patience.",
        });

        /* ---------- ordering and paging ---------- */

        console.log("\nordering and paging");

        const all = await listMessages(db, owner.id, conversationId, { limit: 50 });

        check("four messages in the thread", all.length === 4, all.length);
        check("newest first", all[0].order === 4 && all.at(-1)!.order === 1);

        const page = await listMessages(db, owner.id, conversationId, { limit: 2 });
        const older = await listMessages(db, owner.id, conversationId, { before: page.at(-1)!.order, limit: 2 });

        check("a page holds the limit", page.length === 2);
        check("the next page continues below it", older[0].order === page.at(-1)!.order - 1);
        check("with no overlap", !older.some((row) => page.some((seen) => seen.id === row.id)));

        const recent = await getRecentMessages(db, owner.id, conversationId, 3);

        check("context comes back oldest first", recent[0].order < recent.at(-1)!.order);
        check("and is the tail of the thread", recent.at(-1)!.order === 4);

        /* ---------- the list ---------- */

        console.log("\nthe list");

        const mine = await listConversations(db, owner.id, { limit: 50 });
        const listed = mine.find((row) => row.id === conversationId);

        check("the thread is in its owner's list", listed !== undefined);
        check("with every message counted", listed?.messageCount === 4, listed?.messageCount);
        check(
            "and a preview of the newest one",
            listed?.preview.startsWith("Saturn is asking") ?? false,
            listed?.preview
        );
        check("carrying its status", listed?.lastMessageStatus === "ready", listed?.lastMessageStatus);

        const theirs = await listConversations(db, other.id, { limit: 50 });

        check("another reader's list does not contain it", !theirs.some((row) => row.id === conversationId));

        const firstPage = await listConversations(db, owner.id, { limit: 1 });

        check("a page holds the limit", firstPage.length === 1);

        const cursor = encodeConversationCursor(firstPage[0]);
        const decoded = decodeConversationCursor(cursor);

        check("the cursor round-trips", decoded?.id === firstPage[0].id);
        check("a corrupt cursor decodes to nothing rather than throwing", decodeConversationCursor("!!") === null);

        const secondPage = await listConversations(db, owner.id, { cursor: decoded ?? undefined, limit: 50 });

        check("the next page never repeats the first", !secondPage.some((row) => row.id === firstPage[0].id));

        /* ---------- soft delete ---------- */

        console.log("\nsoft delete");

        check("the thread is hidden", (await softDeleteConversation(db, owner.id, conversationId)) === true);
        check(
            "hiding it twice reports nothing to hide",
            (await softDeleteConversation(db, owner.id, conversationId)) === false
        );
        check(
            "and it is gone from the ownership check",
            (await getConversation(db, owner.id, conversationId)) === null
        );
        check(
            "and out of the list",
            !(await listConversations(db, owner.id, { limit: 50 })).some((row) => row.id === conversationId)
        );

        const afterDelete = await startTurn(db, {
            userId: owner.id,
            conversationId,
            content: "Is anybody there?",
            clientId: crypto.randomUUID(),
        });

        check("a hidden thread cannot be written to", afterDelete === null);
    } finally {
        if (conversationId) {
            await db.delete(chatMessages).where(eq(chatMessages.conversationId, conversationId));
            await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
            console.log("\ncleaned up");
        }
    }

    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
