import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { connectionString, ssl } from "./db/connection";

const sql = postgres(connectionString, { max: 1, ssl });
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
