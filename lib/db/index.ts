import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazily-initialised Postgres connection (Supabase-compatible). The connection
 * is created on first query — never at import time — so `next build` and demo
 * mode work without DATABASE_URL set. `prepare: false` is required for
 * Supabase's transaction pooler. Cached on globalThis to survive dev HMR.
 */
const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
  _db?: PostgresJsDatabase<typeof schema>;
};

function getDb(): PostgresJsDatabase<typeof schema> {
  if (globalForDb._db) return globalForDb._db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Supabase Postgres connection string.",
    );
  }
  const client = globalForDb._pgClient ?? postgres(connectionString, { prepare: false, max: 5 });
  if (process.env.NODE_ENV !== "production") globalForDb._pgClient = client;
  const instance = drizzle(client, { schema });
  if (process.env.NODE_ENV !== "production") globalForDb._db = instance;
  return instance;
}

/** Proxy so `db.select()/db.transaction()` defer connection to first use. */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
