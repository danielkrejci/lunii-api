import { desc, eq, inArray } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { pushTokens } from "../../db/schema";

type Db = FastifyInstance["db"];

/** Every device the reader registered, newest first. */
export async function findPushTokens(db: Db, userId: string): Promise<string[]> {
    const rows = await db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(eq(pushTokens.userId, userId))
        .orderBy(desc(pushTokens.updatedAt));

    return rows.map((row) => row.token);
}

/** For `processReceipts`: tokens Expo reported as no longer installed. */
export async function deletePushTokens(db: Db, tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
        return;
    }

    await db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
}
