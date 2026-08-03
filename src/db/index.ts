import { SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgColumn } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import { env } from "../env";
import * as schema from "./schema";

export const pool = new Pool({
    connectionString: env.POSTGRES_URL,
    max: 5,
    ssl: true,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, {
    schema,
    logger: process.env.NODE_ENV !== "production",
});

export type DbType = typeof db;

export function jsonbAgg<T>(expression: SQL) {
    return sql<T>`jsonb_agg(${expression})`;
}

/**
 * @param shape Potential for SQL injections, so you shouldn't allow user-specified key names
 */
export function jsonbBuildObject<T extends Record<string, PgColumn | SQL>>(shape: T) {
    const chunks: SQL[] = [];

    Object.entries(shape).forEach(([key, value]) => {
        if (chunks.length > 0) {
            chunks.push(sql.raw(","));
        }
        chunks.push(sql.raw(`'${key}',`), sql`${value}`);
    });

    return sql`jsonb_build_object(${sql.join(chunks)})`;
}
