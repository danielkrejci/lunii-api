import { Expo, ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from "expo-server-sdk";

/* ============================================================
   CONTRACT
============================================================ */

/**
 * What the app reads off a notification.
 *
 * `url` is an app route ("/home", "/home/today-insight/moon", ...) and the app navigates
 * to it when the notification is tapped. Anything else in `data` is ignored by the app
 * today, so a notification that should open a screen must say which one here.
 */
export type PushData = {
    url: string;
};

/**
 * One notification to one device.
 *
 * A single token rather than Expo's `to: string[]`, so every ticket belongs to exactly
 * one token — which is what lets a failure be traced back to the row to delete.
 */
export type PushMessage = Omit<ExpoPushMessage, "to" | "data"> & {
    to: string;
    data?: PushData;
};

export type SentPush = {
    token: string;
    ticket: ExpoPushTicket;
};

/** The part of the Expo client used here, so a test can stand in for it. */
export type PushClient = Pick<
    Expo,
    | "chunkPushNotifications"
    | "sendPushNotificationsAsync"
    | "chunkPushNotificationReceiptIds"
    | "getPushNotificationReceiptsAsync"
>;

/**
 * Without an access token, which Expo asks for only once "enhanced push security" is
 * turned on for the project.
 */
export const expoClient: PushClient = new Expo();

/* ============================================================
   SEND
============================================================ */

/**
 * Sends the messages and pairs every ticket with the token it was for.
 *
 * A chunk Expo refuses outright (network, 5xx after its own retries) comes back as error
 * tickets rather than a throw: the other chunks were sent, and a caller sending to many
 * readers should not lose track of them because one request failed. Those tickets carry
 * no `details.error`, so `processReceipts` deletes nothing for them.
 */
export async function sendPush(messages: PushMessage[], client: PushClient = expoClient): Promise<SentPush[]> {
    const sent: SentPush[] = [];

    for (const chunk of client.chunkPushNotifications(messages)) {
        const tokens = chunk.map((message) => message.to as string);

        try {
            const tickets = await client.sendPushNotificationsAsync(chunk);

            // One message per token, so the nth ticket is the nth message's.
            tickets.forEach((ticket, index) => sent.push({ token: tokens[index], ticket }));
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);

            for (const token of tokens) {
                sent.push({ token, ticket: { status: "error", message } });
            }
        }
    }

    return sent;
}

/* ============================================================
   RECEIPTS
============================================================ */

export type ProcessedReceipts = {
    receipts: Record<string, ExpoPushReceipt>;
    /** Tokens Expo reported as uninstalled, whose rows were deleted. */
    unregistered: string[];
};

/**
 * Reads the receipts for what `sendPush` sent and deletes every token the device no
 * longer answers to.
 *
 * `DeviceNotRegistered` can arrive twice: on the ticket, when Expo already knows the
 * token is dead, or on the receipt, once Apple or Google have said so. Both mean the app
 * was uninstalled (or its notifications reset), and both are the only error worth acting
 * on — anything else is a problem with the message or the credentials, not the device.
 *
 * Receipts are available for about a day and only after delivery was attempted, so call
 * this some time after sending; a receipt not ready yet is simply absent.
 */
export async function processReceipts(
    sent: SentPush[],
    deleteTokens: (tokens: string[]) => Promise<unknown>,
    client: PushClient = expoClient
): Promise<ProcessedReceipts> {
    const unregistered = new Set<string>();
    const tokenByReceiptId = new Map<string, string>();

    for (const { token, ticket } of sent) {
        if (ticket.status === "ok") {
            tokenByReceiptId.set(ticket.id, token);
        } else if (ticket.details?.error === "DeviceNotRegistered") {
            unregistered.add(token);
        }
    }

    const receipts: Record<string, ExpoPushReceipt> = {};

    for (const chunk of client.chunkPushNotificationReceiptIds([...tokenByReceiptId.keys()])) {
        Object.assign(receipts, await client.getPushNotificationReceiptsAsync(chunk));
    }

    for (const [id, receipt] of Object.entries(receipts)) {
        const token = tokenByReceiptId.get(id);

        if (token && receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
            unregistered.add(token);
        }
    }

    if (unregistered.size > 0) {
        await deleteTokens([...unregistered]);
    }

    return { receipts, unregistered: [...unregistered] };
}
