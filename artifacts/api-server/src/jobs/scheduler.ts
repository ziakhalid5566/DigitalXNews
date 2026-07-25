/**
 * Cron scheduler for DigitalXNews background jobs.
 *
 * TOKEN BUDGET (Groq free tier = 100,000 TPD):
 *   Each generation run: 8 agents × ~4,100 tokens = ~32,800 tokens
 *   Max safe runs/day:   100,000 ÷ 32,800 ≈ 3 runs/day
 *   Default schedule:    every 8 hours  →  3 × 32,800 = ~98,400 tokens/day ✓
 *   Articles produced:   3 runs × 16 articles = ~48 articles/day
 *
 * To override, set NEWS_GENERATION_CRON env var to any cron expression.
 * Example: "0 6,14,22 * * *"  →  6 AM, 2 PM, 10 PM UTC (same 3/day pattern)
 *
 * Auto-delete: every 15 minutes — removes posts past their 72-hour TTL.
 *
 * NOTE: Startup auto-generation is intentionally DISABLED to avoid consuming
 * the daily token budget on every server restart during development.
 * Trigger manually via POST /api/admin/trigger-generation when needed.
 */

import cron from "node-cron";
import { logger } from "../lib/logger";
import { runNewsGenerationJob } from "./newsGenerationJob";
import { runAutoDeleteJob } from "./autoDeleteJob";

export function startScheduler(): void {
  const newsSchedule = process.env.NEWS_GENERATION_CRON ?? "0 */8 * * *";
  const deleteSchedule = process.env.AUTO_DELETE_CRON ?? "*/15 * * * *";

  // News generation job — runs 3×/day by default
  cron.schedule(newsSchedule, async () => {
    logger.info({ schedule: newsSchedule }, "Cron: news generation triggered");
    await runNewsGenerationJob();
  });

  // Auto-delete expired posts
  cron.schedule(deleteSchedule, async () => {
    await runAutoDeleteJob();
  });

  logger.info(
    { newsSchedule, deleteSchedule },
    "Scheduler started",
  );

  // Startup auto-generation is DISABLED — see note above.
  // To generate immediately: POST /api/admin/trigger-generation
}
