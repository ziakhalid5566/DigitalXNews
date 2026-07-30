# Digital X News

A modern Islamic news mobile app (Expo/React Native) with an X (Twitter) inspired design. 8 AI agents automatically generate and publish news articles every 8 hours via Groq LLMs. Supports Urdu, English, and Arabic with dark/light modes and push notifications.

## Run & Operate

- `pnpm --filter @workspace/digital-x-news run dev` — run the Expo mobile app
- `pnpm --filter @workspace/api-server run dev` — run the Express AI agent server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GROQ_API_KEY_1..4`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo SDK 54 + React Native 0.81 + Expo Router
- Backend: Express 5 + node-cron
- DB: PostgreSQL via Supabase + Drizzle ORM
- AI: 8 Groq agents (Llama 3.1 70B) — 4 key pairs, 2 agents/key
- Realtime reads: Supabase JS SDK direct from mobile

## Where things live

- `artifacts/islamnashra/` — Expo mobile app (Digital X News)
- `artifacts/islamnashra/lib/supabase.ts` — Supabase client singleton
- `artifacts/islamnashra/lib/api.ts` — React Query + Supabase hooks
- `artifacts/islamnashra/lib/types.ts` — Post / UserPreference types
- `artifacts/islamnashra/constants/colors.ts` — X-style design tokens
- `artifacts/api-server/` — Express admin + cron server
- `artifacts/api-server/src/jobs/` — News generation, auto-delete, scheduler
- `artifacts/api-server/src/lib/newsGenerator.ts` — 8-agent AI pipeline
- `lib/db/` — Drizzle schema + Supabase connection
- `supabase/migrations/` — SQL migration files
- `supabase/DEPLOY.md` — Deployment guide for Supabase edge functions

## Architecture

```
Mobile App (Expo — Digital X News)
  ↓ reads posts/preferences via @supabase/supabase-js
Supabase Postgres (ap-southeast-1)
  ↑ writes news articles via Express + Drizzle ORM
Express API Server (always on)
  - node-cron: runs 8 Groq agents every 8 hours
  - node-cron: auto-deletes expired posts every 15 min
  - Admin routes: POST /api/admin/trigger-generation
```

## Architecture decisions

- Supabase Transaction Pooler (not direct connection) — Replit can't reach port 5432 on db.*.supabase.co directly; the pooler at port 6543 works fine
- 4 Groq API keys shared across 8 agents (2 agents/key) — second agent in each pair waits 25s to respect the 12k TPM free-tier limit
- 72-hour TTL on posts — enforced at publish time; auto-delete job removes expired rows
- Mobile app reads directly from Supabase (zero-latency, no Express hop for reads)
- X (Twitter) inspired UI: true black/white + #1D9BF0 blue, tweet-style cards

## Gotchas

- Supabase DB region is `ap-southeast-1` — always use the pooler URL `aws-0-ap-southeast-1.pooler.supabase.com:6543`
- EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are injected at build time via the dev script (from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY secrets)
- pg_cron for auto-delete must be enabled via Supabase Dashboard → Extensions
- After any Drizzle schema change, run `pnpm --filter @workspace/db run push`

## User preferences

- App name: **Digital X News** (English only — no Urdu/Arabic in branding)
- UI design: X (Twitter) style — true black dark mode, clean minimal, X blue (#1D9BF0)
