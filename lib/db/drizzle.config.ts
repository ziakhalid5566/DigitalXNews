import { defineConfig } from "drizzle-kit";
import path from "path";

function buildConnectionString(): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseDbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (supabaseUrl && supabaseDbPassword) {
    const projectRef = supabaseUrl
      .replace(/^https?:\/\//, "")
      .replace(/\.supabase\.co.*$/, "");
    const region = process.env.SUPABASE_DB_REGION ?? "ap-southeast-1";
    const user = encodeURIComponent(`postgres.${projectRef}`);
    const pass = encodeURIComponent(supabaseDbPassword);
    return `postgresql://${user}:${pass}@aws-0-${region}.pooler.supabase.com:6543/postgres`;
  }

  const explicit = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (explicit) return explicit;

  throw new Error(
    "Set SUPABASE_URL + SUPABASE_DB_PASSWORD, NEON_DATABASE_URL, or DATABASE_URL.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: buildConnectionString(),
  },
});
