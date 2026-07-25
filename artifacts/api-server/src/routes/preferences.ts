import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

const preferenceInputSchema = z.object({
  deviceId: z.string().min(1),
  pushToken: z.string().nullable().optional(),
  followedCategories: z.array(z.string()).optional(),
  notificationsEnabled: z.boolean().optional(),
});

// POST /preferences — upsert device preferences
router.post("/preferences", async (req, res): Promise<void> => {
  const parsed = preferenceInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { deviceId, pushToken, followedCategories, notificationsEnabled } = parsed.data;

  const existing = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.deviceId, deviceId));

  let pref;

  if (existing.length > 0) {
    // Partial update — only set fields that were provided
    const updates: Partial<{
      pushToken: string | null;
      followedCategories: string[];
      notificationsEnabled: boolean;
    }> = {};

    if (pushToken !== undefined) updates.pushToken = pushToken;
    if (followedCategories !== undefined) updates.followedCategories = followedCategories;
    if (notificationsEnabled !== undefined) updates.notificationsEnabled = notificationsEnabled;

    [pref] = await db
      .update(userPreferencesTable)
      .set(updates)
      .where(eq(userPreferencesTable.deviceId, deviceId))
      .returning();
  } else {
    [pref] = await db
      .insert(userPreferencesTable)
      .values({
        deviceId,
        pushToken: pushToken ?? null,
        followedCategories: followedCategories ?? [],
        notificationsEnabled: notificationsEnabled ?? true,
      })
      .returning();
  }

  res.json(pref);
});

// GET /preferences/:deviceId — get preferences for a device
router.get("/preferences/:deviceId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.deviceId)
    ? req.params.deviceId[0]
    : req.params.deviceId;

  const [pref] = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.deviceId, raw));

  if (!pref) {
    res.status(404).json({ error: "Preferences not found" });
    return;
  }

  res.json(pref);
});

export default router;
