import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "./env.mjs";

const sql = postgres(env.POSTGRES_URL, { max: 1 });
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
