# DigitalXNews

AI-powered Islamic news app — generates multi-language (EN/UR/AR) news articles via 8 Groq AI agents, with Expo mobile client and Express admin server.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API/admin server (port 5000)
- `pnpm --filter @workspace/islamnashra run dev` — run the Expo mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema to Supabase (uses SUPABASE_URL + SUPABASE_DB_PASSWORD)

## Required Secrets (Replit Secrets)

| Key | Purpose |
|-----|---------|
| `SUPABASE_URL` | Supabase project URL (e.g. https://xxx.supabase.co) |
| `SUPABASE_ANON_KEY` | Supabase anon key (used by Expo app) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (used by Express server) |
| `SUPABASE_DB_PASSWORD` | Supabase postgres password |
| `SUPABASE_DB_REGION` | Supabase DB region (e.g. ap-southeast-1) |
| `GROQ_KEY_A` | Groq key for agents 1+2: world_palestine, south_asia |
| `GROQ_KEY_B` | Groq key for agents 3+4: economy, government |
| `GROQ_KEY_C` | Groq key for agents 5+6: security, scholars_mosques |
| `GROQ_KEY_D` | Groq key for agents 7+8: madrassas, regional |
| `GROQ_API_KEY` | Fallback Groq key (optional) |
| `PEXELS_API_KEY` | Image fetching (Pexels free tier) |
| `SESSION_SECRET` | Express session signing |

## Non-Secret Env Vars

| Key | Value |
|-----|-------|
| `SUPABASE_PROJECT_REF` | `qyrkrmxggorpbcbjxihp` |
| `SUPABASE_DB_REGION` | `ap-southeast-1` |

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **DB**: Supabase PostgreSQL (pooler: `aws-0-ap-southeast-1.pooler.supabase.com:6543`)
- **API server**: Express 5 (admin routes + news generation cron)
- **Mobile**: Expo (React Native) — reads directly from Supabase SDK
- **AI**: Groq (8 agents, llama-3.3-70b-versatile)
- **Images**: Pexels API
- **Push**: Expo push notification service
- **ORM**: Drizzle ORM
- **Validation**: Zod (zod/v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)

## Where things live

- `artifacts/islamnashra/` — Expo mobile app
- `artifacts/islamnashra/lib/supabase.ts` — Supabase client singleton
- `artifacts/islamnashra/lib/api.ts` — React Query + Supabase hooks (replaces api-client-react)
- `artifacts/islamnashra/lib/types.ts` — Post / UserPreference types
- `artifacts/api-server/` — Express admin + cron server
- `artifacts/api-server/src/jobs/` — News generation, auto-delete, scheduler
- `artifacts/api-server/src/lib/newsGenerator.ts` — 8-agent AI pipeline
- `lib/db/` — Drizzle schema + Supabase connection
- `supabase/migrations/` — SQL migration files
- `supabase/functions/` — Supabase Edge Functions (deployable via Supabase CLI)
- `supabase/DEPLOY.md` — Deployment guide for Supabase edge functions + pg_cron

## Architecture

```
Mobile App (Expo)
  ↓ reads posts/preferences via @supabase/supabase-js
Supabase Postgres (ap-southeast-1)
  ↑ writes news articles via Express + Drizzle ORM
Express API Server (always on)
  - node-cron: runs 8 Groq agents every 8 hours
  - node-cron: auto-deletes expired posts every 15 min
  - Admin routes: POST /api/admin/trigger-generation
```

### Future: Supabase Edge Functions
See `supabase/DEPLOY.md` — edge functions are ready to deploy when you want
to remove the dependency on the Express server for news generation.

## Architecture decisions

- Supabase Transaction Pooler (not direct connection) — Replit can't reach port 5432 on db.*.supabase.co directly; the pooler at port 6543 works fine
- 4 Groq API keys shared across 8 agents (2 agents/key) — second agent in each pair waits 25 s to respect the 12k TPM free-tier limit
- 72-hour TTL on posts — enforced at publish time; auto-delete job removes expired rows
- Mobile app reads directly from Supabase (zero-latency, no Express hop for reads)

## Gotchas

- Supabase DB region is `ap-southeast-1` — always use the pooler URL `aws-0-ap-southeast-1.pooler.supabase.com:6543`
- EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are injected at build time via the dev script (from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY secrets)
- pg_cron for auto-delete must be enabled via Supabase Dashboard → Extensions
- After any Drizzle schema change, run `pnpm --filter @workspace/db run push`

## User preferences

_Populate as you build._
