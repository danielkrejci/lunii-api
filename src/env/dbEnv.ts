import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const dbEnv = createEnv({
    server: {
        DATABASE_URL: z.url(),
    },
    client: {},
    experimental__runtimeEnv: {},
});
