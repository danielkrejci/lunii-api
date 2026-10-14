/**
 * Sends a test notification to every device a user registered, then reads the receipts —
 * deleting any token Expo reports as uninstalled, exactly as a real send would.
 *
 *   pnpm tsx src/scripts/sendTestPush.ts <userId>
 *
 * Tapping it should open the home screen: `data.url` is the route the app navigates to.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { db, pool } from "../db";
import { processReceipts, sendPush } from "../modules/push/service";
import { deletePushTokens, findPushTokens } from "../modules/push/tokens";

/** Receipts exist only once delivery was attempted; a few seconds is usually enough. */
const RECEIPT_DELAY_MS = 5_000;

const userId = process.argv[2];

if (!userId) {
    console.error("Usage: pnpm tsx src/scripts/sendTestPush.ts <userId>");
    process.exit(1);
}

try {
    const tokens = await findPushTokens(db, userId);

    if (tokens.length === 0) {
        console.error(`User ${userId} has no registered push tokens.`);
        process.exitCode = 1;
    } else {
        console.log(`Sending to ${tokens.length} device(s)...`);

        const sent = await sendPush(
            tokens.map((token) => ({
                to: token,
                title: "Lunii",
                body: "Test notification",
                data: { url: "/home" },
            }))
        );

        console.log("Tickets:", JSON.stringify(sent, null, 2));
        console.log(`Waiting ${RECEIPT_DELAY_MS / 1000} s for receipts...`);

        await sleep(RECEIPT_DELAY_MS);

        const { receipts, unregistered } = await processReceipts(sent, (dead) => deletePushTokens(db, dead));

        console.log("Receipts:", JSON.stringify(receipts, null, 2));

        if (unregistered.length > 0) {
            console.log(`Deleted ${unregistered.length} unregistered token(s):`, unregistered);
        }
    }
} catch (error: unknown) {
    console.error("Test push failed:", error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
