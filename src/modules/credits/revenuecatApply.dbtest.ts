import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { db, pool } from "../../db";
import { subscriptions, user } from "../../db/schema";
import { applyEvent, linkCustomer } from "./revenuecatApply";
import { hasActiveSubscription } from "./service";

/**
 * A transfer is two accounts and a subscription row keyed on one of them, so there is
 * nothing in it worth checking without a database. Run with `pnpm test:db`.
 */

const enabled = process.env.RUN_DB_TESTS === "1";

const created: string[] = [];

async function makeSubscriber(expiresInMs: number | null): Promise<string> {
    const id = `dbtest_${crypto.randomUUID()}`;

    await db.insert(user).values({ id, name: "Transfer db test", email: `${id}@dbtest.invalid`, emailVerified: false });
    await linkCustomer(db, { appUserIds: [id], userId: id });

    if (expiresInMs !== null) {
        await db.insert(subscriptions).values({
            userId: id,
            status: "active",
            expiresAt: new Date(Date.now() + expiresInMs),
            productId: "com.danielkrejci.lunii.super.monthly",
            store: "APP_STORE",
            environment: "PRODUCTION",
            willRenew: true,
            lastEventAt: new Date(Date.now() - 60_000),
        });
    }

    created.push(id);

    return id;
}

describe("applyEvent TRANSFER against a real database", { skip: enabled ? false : "set RUN_DB_TESTS=1" }, () => {
    after(async () => {
        for (const id of created) {
            await db.delete(user).where(eq(user.id, id));
        }

        await pool.end();
    });

    it("ends the old account's subscription when a restore moves it to another account", async () => {
        const previous = await makeSubscriber(30 * 24 * 3600 * 1000);
        const current = await makeSubscriber(null);

        assert.equal(await hasActiveSubscription(db, previous), true);

        await applyEvent(db, {
            event: {
                id: `evt_${crypto.randomUUID()}`,
                type: "TRANSFER",
                app_user_id: current,
                environment: "PRODUCTION",
                event_timestamp_ms: Date.now(),
                transferred_from: [previous],
                transferred_to: [current],
            },
            userId: current,
        });

        assert.equal(await hasActiveSubscription(db, previous), false, "the old account is no longer unlimited");

        const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, previous));
        assert.equal(row.status, "expired");
        assert.equal(row.willRenew, false);
    });

    it("leaves a subscription alone when the restore lands back on the same account", async () => {
        const reader = await makeSubscriber(30 * 24 * 3600 * 1000);

        await applyEvent(db, {
            event: {
                id: `evt_${crypto.randomUUID()}`,
                type: "TRANSFER",
                app_user_id: reader,
                environment: "PRODUCTION",
                event_timestamp_ms: Date.now(),
                transferred_from: ["$RCAnonymousID:abc", reader],
                transferred_to: [reader],
            },
            userId: reader,
        });

        assert.equal(await hasActiveSubscription(db, reader), true);
    });
});
