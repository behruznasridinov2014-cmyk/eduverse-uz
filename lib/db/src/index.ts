import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const configured = Boolean(process.env.DATABASE_URL);

// Lazy pool: the API boots even without DATABASE_URL and every query then
// fails with a clear, actionable error instead of killing the serverless
// function at import time.
let poolInstance: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (configured) {
  poolInstance = new Pool({ connectionString: process.env.DATABASE_URL });
  dbInstance = drizzle(poolInstance, { schema });
} else {
  console.error(
    "[db] DATABASE_URL is not configured — all database-backed endpoints will fail. " +
      "Set DATABASE_URL in Vercel → Project → Settings → Environment Variables, then redeploy.",
  );
}

export const databaseIsConfigured = () => configured;

export const pool = poolInstance as pg.Pool;
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    if (!dbInstance) {
      throw new Error(
        "DATABASE_URL is not configured on the server. Set it in Vercel → Project → Settings → Environment Variables (Production), then redeploy.",
      );
    }
    const target = dbInstance as unknown as Record<PropertyKey, unknown>;
    const value = target[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

export * from "./schema";
