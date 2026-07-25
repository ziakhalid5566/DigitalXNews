# Supabase Deployment Guide for DigitalXNews

## Project Details
- Project ref: `qyrkrmxggorpbcbjxihp`
- Project URL: `https://qyrkrmxggorpbcbjxihp.supabase.co`

## 1. Run Schema Migration

Connect to Supabase and run the initial migration:

```bash
psql "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.qyrkrmxggorpbcbjxihp.supabase.co:5432/postgres" \
  -f supabase/migrations/00001_init.sql
```

Or via drizzle push (will use Supabase credentials from env):
```bash
pnpm --filter @workspace/db run push
```

## 2. Enable pg_cron for Auto-Delete

In Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable.

Then run:
```bash
psql "postgresql://postgres:$SUPABASE_DB_PASSWORD@db.qyrkrmxggorpbcbjxihp.supabase.co:5432/postgres" \
  -f supabase/migrations/00002_pg_cron.sql
```

This schedules `DELETE FROM posts WHERE expires_at < NOW()` every 15 minutes.

## 3. Deploy Edge Functions (News Generation)

Install Supabase CLI and deploy the news-generation function:

```bash
# Install CLI
npm install -g supabase

# Login (opens browser)
supabase login

# Link project
supabase link --project-ref qyrkrmxggorpbcbjxihp

# Set required secrets for the edge function
supabase secrets set GROQ_KEY_1_WORLD_PALESTINE=<your-key>
supabase secrets set GROQ_KEY_2_SOUTH_ASIA=<your-key>
supabase secrets set GROQ_KEY_3_ECONOMY=<your-key>
supabase secrets set GROQ_KEY_4_GOVERNMENT=<your-key>
supabase secrets set GROQ_KEY_5_SECURITY=<your-key>
supabase secrets set GROQ_KEY_6_SCHOLARS_MOSQUES=<your-key>
supabase secrets set GROQ_KEY_7_MADRASSAS=<your-key>
supabase secrets set GROQ_KEY_8_REGIONAL=<your-key>
supabase secrets set GROQ_API_KEY=<fallback-key>
supabase secrets set PEXELS_API_KEY=<your-key>

# Deploy functions
supabase functions deploy auto-delete
supabase functions deploy news-generation

# Then schedule news-generation via pg_cron (every 8 hours):
# INSERT INTO cron.job (schedule, command, nodename, nodeport, database, username, active, jobname)
# SELECT '0 */8 * * *', 'SELECT net.http_post(url:=''https://qyrkrmxggorpbcbjxihp.supabase.co/functions/v1/news-generation'', headers:=''{}'', body:=''{}'')', ...
```

## 4. Expo App Environment Variables

The Expo app needs these env vars (set in Replit Secrets → already done):
- `SUPABASE_URL` → passed as `EXPO_PUBLIC_SUPABASE_URL` at build time
- `SUPABASE_PUBLISHABLE_KEY` → passed as `EXPO_PUBLIC_SUPABASE_ANON_KEY` at build time

These are wired in `artifacts/islamnashra/package.json` dev script.

## 5. Express API Server

The Express API server (`artifacts/api-server`) continues running and now connects
to Supabase postgres via `SUPABASE_URL` + `SUPABASE_DB_PASSWORD` env vars.

It handles:
- News generation cron jobs (8 Groq agents)
- Admin routes for flagged post review
- Manual trigger: `POST /api/admin/trigger-generation`

The mobile app reads data **directly from Supabase SDK** (bypassing Express for reads).
Express is still needed for news generation until edge functions are fully deployed.
