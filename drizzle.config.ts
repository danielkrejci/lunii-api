import { Config, defineConfig } from "drizzle-kit";

import { dbEnv } from "./src/env/dbEnv";

export default defineConfig({
    out: "./drizzle",
    schema: "./src/db/schema.ts",
    dialect: "postgresql",
    dbCredentials: {
        url: dbEnv.DATABASE_URL,
    },
}) satisfies Config;
