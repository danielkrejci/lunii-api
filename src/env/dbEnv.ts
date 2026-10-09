import { createEnv } from "@t3-oss/env-nextjs";
import { config } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") {
    config({ path: ".env.local", override: true });
}

export const dbEnv = createEnv({
    server: {
        DATABASE_URL: z.url(),
    },
    client: {},
    experimental__runtimeEnv: {},
});
