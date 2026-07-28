/**
 * Cron scheduler — DigitalXNews background jobs.
 *
 * AGENT ROTATION STRATEGY:
 *   Every 5 minutes, one agent runs in sequence (agent 0 → 1 → 2 → … → 7 → 0 → …).
 *   This means:
 *     • A new post appears every ~5 minutes throughout the day
 *     • No agent pile-up — no rate-limit spikes
 *     • Full 8-agent cycle completes in 40 minutes
 *
 * TOKEN BUDGET (Gemini free tier = 1,500 RPD):
 *   Per agent call: ~4,000 tokens
 *   Calls per day: 24h × 60m ÷ 5m × 1/8 agents = ~36 calls per agent/day
 *   Total: 8 × 36 × 4,000 ≈ 1,152,000 tokens/day   (paid tier recommended)
 *   Free tier: use NEWS_GENERATION_CRON override to slow down if needed
 *
 * Override env vars:
 *   AGENT_CRON   — cron for the rotating agent (default: every 5 min)
 *   AUTO_DELETE_CRON — cron for auto-delete (default: every 15 min)
 */

import cron from "node-cron";
import { logger } from "../lib/logger";
import { runNewsGenerationJob, runSingleAgentJob, AGENT_COUNT } from "./newsGenerationJob";
import { runAutoDeleteJob } from "./autoDeleteJob";

// Re-export AGENT_COUNT so newsGenerationJob can be a clean module
export { AGENT_COUNT };

export function startScheduler(): void {
  const agentCron = process.env.AGENT_CRON ?? "*/5 * * * *";
  const deleteSchedule = process.env.AUTO_DELETE_CRON ?? "*/15 * * * *";

  // Rotating agent index — persisted in memory for the lifetime of the process
  let currentAgent = 0;

  // Every 5 minutes: run the next agent in sequence
  cron.schedule(agentCron, async () => {
    const agentIndex = currentAgent;
    currentAgent = (currentAgent + 1) % AGENT_COUNT;
    logger.info({ agentIndex, next: currentAgent, schedule: agentCron }, "Cron: single agent triggered");
    await runSingleAgentJob(agentIndex);
  });

  // Every 15 minutes: delete posts older than 24 h
  cron.schedule(deleteSchedule, async () => {
    await runAutoDeleteJob();
  });

  logger.info({ agentCron, deleteSchedule, agentCount: AGENT_COUNT }, "Scheduler started");

  // NOTE: Startup auto-generation is DISABLED to avoid consuming quota on every restart.
  // To generate immediately: POST /api/admin/trigger-generation
}
