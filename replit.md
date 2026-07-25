# DigitalXNews

AI-powered اسلامی خبریں platform — Groq AI کے 8 specialized agents سے اردو، انگریزی اور عربی میں خبریں generate کرتا ہے۔

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server چلائیں (port 8080)
- `pnpm --filter @workspace/islamnashra run dev` — Expo mobile app چلائیں
- `pnpm run typecheck` — full typecheck
- `pnpm run build` — typecheck + build
- `pnpm --filter @workspace/api-spec run codegen` — API hooks اور Zod schemas regenerate کریں
- `pnpm --filter @workspace/db run push` — DB schema push کریں (dev only)
- `POST /api/admin/trigger-generation` — فوری خبریں generate کریں

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo (React Native) + Expo Router
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: Groq SDK — 8 specialized agents، ہر agent کی اپنی الگ API key
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/api-server/src/` — Express API server
  - `routes/posts.ts` — news posts CRUD
  - `routes/preferences.ts` — device preferences & push tokens
  - `routes/admin.ts` — content moderation & manual generation trigger
  - `lib/newsGenerator.ts` — 8 Groq AI agents (per-agent dedicated keys)
  - `lib/contentModeration.ts` — content safety filter
  - `lib/pushNotifications.ts` — Expo push notifications
  - `jobs/scheduler.ts` — cron: news every 8h, auto-delete every 15min
- `artifacts/islamnashra/` — Expo mobile app
  - `app/(tabs)/index.tsx` — main news feed
  - `app/(tabs)/search.tsx` — search screen
  - `app/(tabs)/notifications.tsx` — notifications
  - `app/(tabs)/settings.tsx` — settings & language
  - `app/post/[id].tsx` — post detail
  - `contexts/LanguageContext.tsx` — Urdu/English/Arabic language switching
  - `contexts/NotificationsContext.tsx` — push notifications state
  - `components/NewsCard.tsx` — news card component
  - `components/SkeletonCard.tsx` — loading skeleton
- `lib/db/src/schema/` — Drizzle ORM schemas (posts, userPreferences, flaggedPosts)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth)
- `lib/api-client-react/` — generated React Query hooks
- `AGENTS.md` — مکمل agent/key reference (future AI agents کے لیے)

## Admin API

- `POST /api/admin/trigger-generation` — manually trigger AI news generation
- `GET /api/admin/flagged` — list posts pending moderation
- `POST /api/admin/flagged/:id/approve` — approve a flagged post
- `POST /api/admin/flagged/:id/reject` — reject a flagged post

## Required Secrets

ہر agent کی اپنی الگ Groq key ہے (الگ rate-limit bucket):

| Secret | Agent | Purpose |
|--------|-------|---------|
| `GROQ_KEY_1_WORLD_PALESTINE` | Agent 1 | عالمی خبریں + فلسطین |
| `GROQ_KEY_2_SOUTH_ASIA` | Agent 2 | جنوبی ایشیا |
| `GROQ_KEY_3_ECONOMY` | Agent 3 | معیشت |
| `GROQ_KEY_4_GOVERNMENT` | Agent 4 | حکومت |
| `GROQ_KEY_5_SECURITY` | Agent 5 | سیکیورٹی |
| `GROQ_KEY_6_SCHOLARS_MOSQUES` | Agent 6 | علماء + مساجد |
| `GROQ_KEY_7_MADRASSAS` | Agent 7 | مدارس |
| `GROQ_KEY_8_REGIONAL` | Agent 8 | افریقہ + ترکی + کمیونٹی |
| `GROQ_API_KEY` | Fallback | اگر کوئی specific key نہ ہو |
| `DATABASE_URL` | — | PostgreSQL (runtime managed by Replit) |
| `SESSION_SECRET` | — | Express session |
| `GITHUB_TOKEN` | — | GitHub push + secrets sync |

## Gotchas

- ہر agent کی اپنی Groq key سے generation time ~4 min سے ~1 min ہو گیا
- اگر per-agent key نہ ہو تو auto-fallback GROQ_API_KEY پر، 22s delay apply ہوتی ہے
- DATABASE_URL runtime-managed by Replit — manually set نہ کریں
- News generation ہر 8 گھنٹے بعد خودبخود چلتی ہے؛ manual: `POST /api/admin/trigger-generation`
- islamnashra artifact.toml uses `router = "expo-domain"` — Expo via `$REPLIT_EXPO_DEV_DOMAIN`
- News auto-expires 72h بعد؛ auto-delete ہر 15 منٹ

## Git Push

```bash
git add -A && git commit -m "message" && git push origin main
```

Token `GITHUB_TOKEN` secret میں ہے اور remote URL میں embed ہے۔

## User Preferences

- GitHub repo: https://github.com/ziakhalid5566/IslamNashra.git
- Full agent/key reference: `AGENTS.md` دیکھیں
