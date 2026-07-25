# DigitalXNews — AI Agents Reference

> **For AI agents, developers, and future contributors.**
> This file explains the 8-agent AI news generation system:
> which Groq API key each agent uses, what it covers, and how to configure it.

---

## Architecture Overview

DigitalXNews uses **8 specialized AI agents** (powered by Groq's `llama-3.3-70b-versatile` model)
to generate Islamic news across 13 categories. Each agent has its **own dedicated Groq API key**,
giving it a separate 12,000 TPM (tokens per minute) rate-limit bucket.

```
Groq Account 1  →  Agent 1 (world_palestine)   GROQ_KEY_1_WORLD_PALESTINE
Groq Account 2  →  Agent 2 (south_asia)         GROQ_KEY_2_SOUTH_ASIA
Groq Account 3  →  Agent 3 (economy)            GROQ_KEY_3_ECONOMY
Groq Account 4  →  Agent 4 (government)         GROQ_KEY_4_GOVERNMENT
Groq Account 5  →  Agent 5 (security)           GROQ_KEY_5_SECURITY
Groq Account 6  →  Agent 6 (scholars_mosques)   GROQ_KEY_6_SCHOLARS_MOSQUES
Groq Account 7  →  Agent 7 (madrassas)          GROQ_KEY_7_MADRASSAS
Groq Account 8  →  Agent 8 (regional)           GROQ_KEY_8_REGIONAL
```

**Fallback:** If a per-agent key is missing, `GROQ_API_KEY` is used (shared bucket,
and a 22s inter-agent delay is applied automatically to protect the shared rate limit).

---

## Agent Details

| # | Name | Env Key | Categories | Countries / Topics |
|---|------|---------|------------|--------------------|
| 1 | `world_palestine` | `GROQ_KEY_1_WORLD_PALESTINE` | World, Palestine | OIC, Gaza, West Bank, Al-Aqsa, UN resolutions, Muslim diaspora |
| 2 | `south_asia` | `GROQ_KEY_2_SOUTH_ASIA` | South Asia | Pakistan, Bangladesh, India Muslims, Afghanistan, Kashmir, Rohingya |
| 3 | `economy` | `GROQ_KEY_3_ECONOMY` | Economy | Islamic banking, sukuk, halal economy, Saudi Vision 2030, Gulf finance |
| 4 | `government` | `GROQ_KEY_4_GOVERNMENT` | Government | Elections, legislation, foreign policy (Saudi, UAE, Turkey, Iran, Pakistan…) |
| 5 | `security` | `GROQ_KEY_5_SECURITY` | Security | Conflicts, peace processes, humanitarian crises, refugees (Syria, Yemen…) |
| 6 | `scholars_mosques` | `GROQ_KEY_6_SCHOLARS_MOSQUES` | Scholars, Mosques | Fatwas, Al-Azhar, Mecca/Medina, mosque construction, Quran competitions |
| 7 | `madrassas` | `GROQ_KEY_7_MADRASSAS` | Madrassas | Madrassa reforms (Pakistan, Bangladesh, Egypt), IIU, online Islamic learning |
| 8 | `regional` | `GROQ_KEY_8_REGIONAL` | Africa, Southeast Asia, Turkey, Community | Nigeria, Indonesia, Malaysia, Turkey, Western Muslims |

---

## Rate Limit Strategy

| Scenario | Delay between agents | Total runtime |
|----------|---------------------|---------------|
| All 8 keys set (recommended) | 2s (DB write buffer only) | ~1 minute |
| Falling back to shared `GROQ_API_KEY` | 22s per agent | ~4 minutes |

**Why 22s on shared key?**  
Groq free tier = 12,000 TPM = 200 tokens/second.  
Each agent uses ~4,100 tokens. At 200 tok/s, it takes ~20s for the bucket to
refill enough for the next agent. The 22s gap ensures we stay safely under the limit.

---

## Required Secrets

Set these in **both** Replit Secrets and GitHub Actions Secrets:

```
GROQ_KEY_1_WORLD_PALESTINE   # Agent 1 — World + Palestine
GROQ_KEY_2_SOUTH_ASIA        # Agent 2 — South Asia
GROQ_KEY_3_ECONOMY           # Agent 3 — Economy
GROQ_KEY_4_GOVERNMENT        # Agent 4 — Government
GROQ_KEY_5_SECURITY          # Agent 5 — Security
GROQ_KEY_6_SCHOLARS_MOSQUES  # Agent 6 — Scholars + Mosques
GROQ_KEY_7_MADRASSAS         # Agent 7 — Madrassas
GROQ_KEY_8_REGIONAL          # Agent 8 — Regional
GROQ_API_KEY                 # Shared fallback (optional if all 8 are set)
DATABASE_URL                 # PostgreSQL connection string (managed by Replit)
GITHUB_TOKEN                 # GitHub Personal Access Token (for secret sync scripts)
SESSION_SECRET               # Express session secret
```

---

## How to Get 8 Free Groq API Keys

1. Go to [console.groq.com](https://console.groq.com)
2. Create 8 separate Groq accounts (each gets 12,000 TPM free)
3. Generate one API key per account
4. Add each key to Replit Secrets under the name shown above

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
