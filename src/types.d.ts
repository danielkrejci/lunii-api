import { DbType } from "./db";
import { AuthType } from "./lib/auth";

declare module "fastify" {
    export interface FastifyInstance {
        db: DbType;
        auth: AuthType;
    }
}
