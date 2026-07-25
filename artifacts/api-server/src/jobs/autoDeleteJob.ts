/**
 * Auto-Delete Job
 *
 * Runs every 15 minutes and hard-deletes any post where expires_at < NOW().
 * This is a non-negotiable rule enforced by this job.
 *
 * 72-hour expiry is set at publish time (publishedAt + 72h = expiresAt).
 */

import { db } from "@workspace/db";
import { postsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "../lib/logger";

export async function runAutoDeleteJob(): Promise<void> {
  try {
    const now = new Date();
    const deleted = await db
      .delete(postsTable)
      .where(lt(postsTable.expiresAt, now))
      .returning({ id: postsTable.id });

    if (deleted.length > 0) {
      logger.info({ deletedCount: deleted.length }, "Auto-delete: expired posts removed");
    }
  } catch (err) {
    logger.error({ err }, "Auto-delete job failed");
  }
}
