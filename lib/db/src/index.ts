import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

/**
 * Build the postgres connection string, preferring Supabase credentials.
 *
 * Priority:
 *  1. SUPABASE_URL + SUPABASE_DB_PASSWORD  → Supabase direct connection
 *  2. NEON_DATABASE_URL                     → legacy Neon / explicit override
 *  3. DATABASE_URL                          → Replit-managed fallback
 */
function buildConnectionString(): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseDbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (supabaseUrl && supabaseDbPassword) {
    const projectRef = supabaseUrl
      .replace(/^https?:\/\//, "")
      .replace(/\.supabase\.co.*$/, "");
    // Use Transaction Pooler (port 6543) — direct connection (port 5432)
    // may not be reachable from all hosting environments.
    const region = process.env.SUPABASE_DB_REGION ?? "ap-southeast-1";
    const user = encodeURIComponent(`postgres.${projectRef}`);
    const pass = encodeURIComponent(supabaseDbPassword);
    return `postgresql://${user}:${pass}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
  }

  const explicit = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (explicit) return explicit;

  throw new Error(
    "No database connection string available. " +
      "Set SUPABASE_URL + SUPABASE_DB_PASSWORD, NEON_DATABASE_URL, or DATABASE_URL.",
  );
}

const connectionString = buildConnectionString();

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
