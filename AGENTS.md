# DigitalXNews — AI Agents Reference

> **For AI agents, developers, and future contributors.**
> This file explains the 8-agent AI news generation system:
> which Groq API key each agent uses, what it covers, and how to configure it.

---

## Architecture Overview

DigitalXNews uses **8 specialized AI agents** (powered by Groq's `llama-3.3-70b-versatile` model)
to generate Islamic news across 13 categories. Agents are paired onto **4 shared Groq API keys**
(2 agents per key). Within each pair, the second agent waits 25 seconds after the first to stay
within Groq's free-tier 12,000 TPM rate limit.

```
GROQ_KEY_A  →  Agent 1 (world_palestine)  [pair 1/2]
              Agent 2 (south_asia)         [pair 2/2 — 25 s stagger]

GROQ_KEY_B  →  Agent 3 (economy)          [pair 1/2]
              Agent 4 (government)         [pair 2/2 — 25 s stagger]

GROQ_KEY_C  →  Agent 5 (security)         [pair 1/2]
              Agent 6 (scholars_mosques)   [pair 2/2 — 25 s stagger]

GROQ_KEY_D  →  Agent 7 (madrassas)        [pair 1/2]
              Agent 8 (regional)           [pair 2/2 — 25 s stagger]
```

**Fallback:** If a key is missing, `GROQ_API_KEY` is used instead.

---

## Agent Details

| # | Name | Env Key | Pair Role | Categories | Countries / Topics |
|---|------|---------|-----------|------------|--------------------|
| 1 | `world_palestine` | `GROQ_KEY_A` | 1/2 (first) | World, Palestine | OIC, Gaza, West Bank, Al-Aqsa, UN resolutions, Muslim diaspora |
| 2 | `south_asia` | `GROQ_KEY_A` | 2/2 (25 s stagger) | South Asia | Pakistan, Bangladesh, India Muslims, Afghanistan, Kashmir, Rohingya |
| 3 | `economy` | `GROQ_KEY_B` | 1/2 (first) | Economy | Islamic banking, sukuk, halal economy, Saudi Vision 2030, Gulf finance |
| 4 | `government` | `GROQ_KEY_B` | 2/2 (25 s stagger) | Government | Elections, legislation, foreign policy (Saudi, UAE, Turkey, Iran, Pakistan…) |
| 5 | `security` | `GROQ_KEY_C` | 1/2 (first) | Security | Conflicts, peace processes, humanitarian crises, refugees (Syria, Yemen…) |
| 6 | `scholars_mosques` | `GROQ_KEY_C` | 2/2 (25 s stagger) | Scholars, Mosques | Fatwas, Al-Azhar, Mecca/Medina, mosque construction, Quran competitions |
| 7 | `madrassas` | `GROQ_KEY_D` | 1/2 (first) | Madrassas | Madrassa reforms (Pakistan, Bangladesh, Egypt), IIU, online Islamic learning |
| 8 | `regional` | `GROQ_KEY_D` | 2/2 (25 s stagger) | Africa, Southeast Asia, Turkey, Community | Nigeria, Indonesia, Malaysia, Turkey, Western Muslims |

---

## Rate Limit Strategy

| Delay | When | Reason |
|-------|------|--------|
| 0 ms | First agent in a key-pair | No stagger needed — fresh bucket |
| 25,000 ms | Second agent in a key-pair | Shared bucket must refill before next ~4,100-token call |
| 2,000 ms | First agent of a new key-pair | Different bucket — short gap to smooth DB writes only |

**Total runtime per generation run:** ~(8 × 8 s API) + (4 × 25 s stagger) ≈ **3.5 minutes**  
(well within the 8-hour window between runs — 3 runs/day × 32,800 tokens ≈ 98,400 tokens/day)

---

## Required Secrets

Set these in **Replit Secrets** (and Supabase Edge Function secrets when deploying the edge function):

```
GROQ_KEY_A                   # Agents 1 + 2: world_palestine, south_asia
GROQ_KEY_B                   # Agents 3 + 4: economy, government
GROQ_KEY_C                   # Agents 5 + 6: security, scholars_mosques
GROQ_KEY_D                   # Agents 7 + 8: madrassas, regional
GROQ_API_KEY                 # Shared fallback (optional if all 4 are set)
PEXELS_API_KEY               # Image fetching (Pexels free tier)
SUPABASE_URL                 # Supabase project URL
SUPABASE_ANON_KEY            # Supabase anon key (for Expo app)
SUPABASE_SERVICE_ROLE_KEY    # Supabase service role key (for Express server)
SUPABASE_DB_PASSWORD         # Supabase postgres password (for Drizzle ORM)
SUPABASE_DB_REGION           # e.g. ap-southeast-1
SESSION_SECRET               # Express session signing
```

---

## How to Get 4 Free Groq API Keys

1. Go to [console.groq.com](https://console.groq.com)
2. Create **4** Groq accounts (each gets 12,000 TPM free)
3. Generate one API key per account
4. Add each key to Replit Secrets as `GROQ_KEY_A`, `GROQ_KEY_B`, `GROQ_KEY_C`, `GROQ_KEY_D`

---

## Source Files

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/newsGenerator.ts` | Agent definitions, Groq calls, key routing |
| `artifacts/api-server/src/jobs/newsGenerationJob.ts` | Runs `generateNewsArticles()` and saves to DB |
| `artifacts/api-server/src/jobs/scheduler.ts` | Cron: news every 8h, expired posts deleted every 15min |
| `artifacts/api-server/src/routes/admin.ts` | `POST /api/admin/trigger-generation` — manual trigger |

---

## Adding a 9th Agent

1. Add a new Groq free-tier account and key
2. Add to Replit Secrets as `GROQ_KEY_9_<NAME>`
3. Add to GitHub Actions Secrets
4. Add a new `AgentConfig` object to the `AGENTS` array in `newsGenerator.ts`
5. Add the new category to the `CATEGORIES` array if needed
6. Push schema changes via `pnpm --filter @workspace/db db:push`
