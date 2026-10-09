import fs from "node:fs";

import { dbEnv } from "../env/dbEnv";

const url = new URL(dbEnv.DATABASE_URL);
// The driver lets these URL params override the `ssl` option, so they are dropped and the CA is passed explicitly.
["sslmode", "sslrootcert"].forEach((k) => url.searchParams.delete(k));

export const connectionString = url.toString();

export const ssl = {
    ca: fs.readFileSync("./ca-certificate.crt", "utf8"),
};
