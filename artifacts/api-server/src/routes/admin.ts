/**
 * Admin routes for content moderation.
 *
 * Protected by ADMIN_API_KEY env var. Set it in production; if unset,
 * only localhost requests are allowed through.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { flaggedPostsTable, postsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runNewsGenerationJob } from "../jobs/newsGenerationJob";

const router: IRouter = Router();

/** Simple API key guard — set ADMIN_API_KEY env var to enable. */
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    // No key configured → allow only loopback
    const ip = req.ip ?? "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return next();
    }
    res.status(401).json({ error: "ADMIN_API_KEY not configured; remote access denied" });
    return;
  }
  const provided = req.headers["x-admin-key"] ?? req.query["adminKey"];
  if (provided !== adminKey) {
    res.status(401).json({ error: "Invalid admin key" });
    return;
  }
  next();
}

router.use(adminAuth);

// GET /admin/flagged — list all posts awaiting moderation
router.get("/admin/flagged", async (_req, res): Promise<void> => {
  const flagged = await db
    .select()
    .from(flaggedPostsTable)
    .orderBy(flaggedPostsTable.flaggedAt);

  res.json(flagged);
});

// POST /admin/flagged/:id/approve — approve and publish a flagged post
router.post("/admin/flagged/:id/approve", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [flagged] = await db
    .select()
    .from(flaggedPostsTable)
    .where(eq(flaggedPostsTable.id, raw));

  if (!flagged) {
    res.status(404).json({ error: "Flagged post not found" });
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [post] = await db
    .insert(postsTable)
    .values({
      title: flagged.title,
      body: flagged.body,
      category: flagged.category,
      imageUrl: null,
      hasImage: false,
      significanceScore: flagged.significanceScore,
      sourceNote: flagged.sourceNote,
      publishedAt: now,
      expiresAt,
      isBreaking: false,
    })
    .returning();

  // Remove from flagged queue
  await db.delete(flaggedPostsTable).where(eq(flaggedPostsTable.id, raw));

  req.log.info({ postId: post.id, title: post.title }, "Flagged post approved and published");
  res.json(post);
});

// POST /admin/flagged/:id/reject — reject and permanently delete a flagged post
router.post("/admin/flagged/:id/reject", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [flagged] = await db
    .select()
    .from(flaggedPostsTable)
    .where(eq(flaggedPostsTable.id, raw));

  if (!flagged) {
    res.status(404).json({ error: "Flagged post not found" });
    return;
  }

  await db.delete(flaggedPostsTable).where(eq(flaggedPostsTable.id, raw));

  req.log.info({ id: raw, title: flagged.title }, "Flagged post rejected and deleted");
  res.sendStatus(204);
});

// POST /admin/trigger-generation — manually kick off a news generation cycle
router.post("/admin/trigger-generation", async (req, res): Promise<void> => {
  req.log.info("Manual news generation triggered via admin route");
  // Run in background so the HTTP response returns immediately
  runNewsGenerationJob().catch((err: unknown) => {
    req.log.error({ err }, "Manual news generation failed");
  });
  res.json({ ok: true, message: "News generation job started in background" });
});

export default router;
