import fs from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { env } from "./env";

const url = new URL(env.POSTGRES_URL);
["sslmode", "sslrootcert"].forEach((k) => url.searchParams.delete(k));

const sql = postgres(url.toString(), {
    max: 1,
    ssl: {
        ca: fs.readFileSync("./ca-certificate.crt", "utf8"),
    },
});
const db = drizzle(sql);

async function main() {
    console.log("Running database migrations...");
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("Migrations completed");
    process.exit(0);
}

main().catch((err) => {
    console.error("Migration failed");
    console.error(err);
    process.exit(1);
});
