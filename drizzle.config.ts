import { Config, defineConfig } from "drizzle-kit";

import { appEnv } from "./src/env";

export default defineConfig({
    out: "./drizzle",
    schema: "./src/db/schema.ts",
    dialect: "postgresql",
    dbCredentials: {
        url: appEnv.DATABASE_URL,
    },
}) satisfies Config;
