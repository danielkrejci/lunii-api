import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExpoPushMessage, ExpoPushReceipt, ExpoPushTicket } from "expo-server-sdk";

import { processReceipts, PushClient, PushMessage, SentPush, sendPush } from "./service";

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";
const TOKEN_C = "ExponentPushToken[cccccccccccccccccccccc]";

function message(to: string): PushMessage {
    return { to, title: "Lunii", body: "Test notification", data: { url: "/home" } };
}

/**
 * A client that answers from tables instead of the network. Chunks of `chunkSize`, so a
 * test can see a request fail without the others failing with it.
 */
function fakeClient(options: {
    tickets?: (chunk: ExpoPushMessage[]) => ExpoPushTicket[];
    receipts?: Record<string, ExpoPushReceipt>;
    chunkSize?: number;
}) {
    const chunkSize = options.chunkSize ?? 100;
    const sentChunks: ExpoPushMessage[][] = [];
    const requestedReceiptIds: string[][] = [];

    const chunk = <T>(items: T[]): T[][] => {
        const chunks: T[][] = [];

        for (let index = 0; index < items.length; index += chunkSize) {
            chunks.push(items.slice(index, index + chunkSize));
        }

        return chunks;
    };

    const client: PushClient = {
        chunkPushNotifications: (messages) => chunk(messages),
        chunkPushNotificationReceiptIds: (ids) => chunk(ids),
        sendPushNotificationsAsync: async (messages) => {
            sentChunks.push(messages);

            return (options.tickets ?? ((all) => all.map((_, index) => ({ status: "ok", id: `r${index}` }))))(messages);
        },
        getPushNotificationReceiptsAsync: async (ids) => {
            requestedReceiptIds.push(ids);

            return Object.fromEntries(
                ids.filter((id) => options.receipts?.[id]).map((id) => [id, options.receipts![id]])
            );
        },
    };

    return { client, sentChunks, requestedReceiptIds };
}

function recordingDelete() {
    const calls: string[][] = [];

    return {
        calls,
        deleteTokens: async (tokens: string[]) => {
            calls.push(tokens);
        },
    };
}

const deviceNotRegistered = {
    status: "error",
    message: "The device is not registered.",
    details: { error: "DeviceNotRegistered" },
} as const;

describe("sendPush", () => {
    it("pairs every ticket with the token its message went to", async () => {
        const { client } = fakeClient({
            tickets: (chunk) => chunk.map((m) => ({ status: "ok", id: `receipt-${m.to as string}` })),
        });

        const sent = await sendPush([message(TOKEN_A), message(TOKEN_B)], client);

        assert.deepEqual(sent, [
            { token: TOKEN_A, ticket: { status: "ok", id: `receipt-${TOKEN_A}` } },
            { token: TOKEN_B, ticket: { status: "ok", id: `receipt-${TOKEN_B}` } },
        ]);
    });

    it("passes the route the app opens on tap through untouched", async () => {
        const { client, sentChunks } = fakeClient({});

        await sendPush([message(TOKEN_A)], client);

        assert.deepEqual(sentChunks[0][0].data, { url: "/home" });
    });

    /**
     * One failed request must not cost the rest of a send: the other chunks went out, and
     * their tickets are what the receipts are read from.
     */
    it("turns a chunk Expo refused into error tickets and keeps the others", async () => {
        let call = 0;
        const { client } = fakeClient({
            chunkSize: 1,
            tickets: () => {
                call += 1;

                if (call === 1) {
                    throw new Error("socket hang up");
                }

                return [{ status: "ok", id: "r-b" }];
            },
        });

        const sent = await sendPush([message(TOKEN_A), message(TOKEN_B)], client);

        assert.deepEqual(sent, [
            { token: TOKEN_A, ticket: { status: "error", message: "socket hang up" } },
            { token: TOKEN_B, ticket: { status: "ok", id: "r-b" } },
        ]);
    });
});

describe("processReceipts", () => {
    it("deletes a token whose receipt says the device is gone", async () => {
        const { client } = fakeClient({
            receipts: {
                "r-a": { status: "ok" },
                "r-b": deviceNotRegistered,
            },
        });
        const { calls, deleteTokens } = recordingDelete();

        const sent: SentPush[] = [
            { token: TOKEN_A, ticket: { status: "ok", id: "r-a" } },
            { token: TOKEN_B, ticket: { status: "ok", id: "r-b" } },
        ];

        const result = await processReceipts(sent, deleteTokens, client);

        assert.deepEqual(calls, [[TOKEN_B]]);
        assert.deepEqual(result.unregistered, [TOKEN_B]);
    });

    it("deletes a token whose ticket already said so, without asking for a receipt", async () => {
        const { client, requestedReceiptIds } = fakeClient({});
        const { calls, deleteTokens } = recordingDelete();

        await processReceipts([{ token: TOKEN_A, ticket: deviceNotRegistered }], deleteTokens, client);

        assert.deepEqual(calls, [[TOKEN_A]]);
        assert.deepEqual(requestedReceiptIds, [], "an error ticket has no receipt to read");
    });

    /**
     * Every other error is about the message or the credentials. Deleting the token for
     * one of those would silence a reader's phone over a bug on our side.
     */
    it("keeps tokens whose errors are not about the device", async () => {
        const { client } = fakeClient({
            receipts: {
                "r-a": { status: "error", message: "Too big", details: { error: "MessageTooBig" } },
            },
        });
        const { calls, deleteTokens } = recordingDelete();

        const result = await processReceipts(
            [
                { token: TOKEN_A, ticket: { status: "ok", id: "r-a" } },
                { token: TOKEN_B, ticket: { status: "error", message: "socket hang up" } },
                { token: TOKEN_C, ticket: { status: "ok", id: "r-c" } },
            ],
            deleteTokens,
            client
        );

        assert.deepEqual(calls, [], "nothing was deleted, and the store was not even called");
        assert.deepEqual(result.unregistered, []);
    });

    it("reads the receipts in the client's chunks and collects all of them", async () => {
        const { client, requestedReceiptIds } = fakeClient({
            chunkSize: 2,
            receipts: { r1: { status: "ok" }, r2: { status: "ok" }, r3: deviceNotRegistered },
        });
        const { calls, deleteTokens } = recordingDelete();

        const result = await processReceipts(
            [
                { token: TOKEN_A, ticket: { status: "ok", id: "r1" } },
                { token: TOKEN_B, ticket: { status: "ok", id: "r2" } },
                { token: TOKEN_C, ticket: { status: "ok", id: "r3" } },
            ],
            deleteTokens,
            client
        );

        assert.deepEqual(requestedReceiptIds, [["r1", "r2"], ["r3"]]);
        assert.deepEqual(Object.keys(result.receipts).sort(), ["r1", "r2", "r3"]);
        assert.deepEqual(calls, [[TOKEN_C]]);
    });
});
