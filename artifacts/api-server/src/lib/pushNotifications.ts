/**
 * Push notification service using Expo Push Notification API.
 *
 * Uses Expo's 2-step flow:
 *   Step 1 — send messages → receive tickets (each has receiptId or error)
 *   Step 2 — after 30 s, fetch receipts → handle DeviceNotRegistered by
 *             removing the stale token from Supabase user_preferences.
 *
 * Note: Expo's push service is free but has practical rate limits.
 * At large scale (many thousands of users), consider a dedicated
 * push infrastructure (FCM/APNs directly).
 */

import Expo, { type ExpoPushMessage, type ExpoPushTicket, type ExpoPushReceiptId } from "expo-server-sdk";
import { eq, isNotNull } from "drizzle-orm";
import { db, userPreferencesTable } from "@workspace/db";
import { logger } from "./logger";

const expo = new Expo();

/** Remove a stale/invalid push token from the database so it is never used again. */
async function removeStaleTokenFromSupabase(token: string): Promise<void> {
  try {
    await db
      .update(userPreferencesTable)
      .set({ pushToken: null })
      .where(eq(userPreferencesTable.pushToken, token));
    logger.info({ token: token.slice(-8) }, "Stale push token removed");
  } catch (err) {
    logger.warn({ err }, "Error removing stale push token");
  }
}

/** Step 2 — poll Expo receipts and clean up DeviceNotRegistered tokens. */
async function checkReceipts(
  receiptIds: ExpoPushReceiptId[],
  tokenByReceiptId: Map<ExpoPushReceiptId, string>,
): Promise<void> {
  if (receiptIds.length === 0) return;

  const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === "error") {
          const details = (receipt as { details?: { error?: string } }).details;
          logger.warn(
            { receiptId, error: receipt.message, details },
            "Push receipt error",
          );
          if (details?.error === "DeviceNotRegistered") {
            const token = tokenByReceiptId.get(receiptId as ExpoPushReceiptId);
            if (token) {
              await removeStaleTokenFromSupabase(token);
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to fetch push notification receipts");
    }
  }
}

/**
 * Send push notifications to a list of Expo push tokens.
 * Automatically filters invalid tokens and batches requests.
 * Schedules a receipt check after 30 s to clean up stale tokens.
 */
export async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));

  if (validTokens.length === 0) {
    logger.info("No valid Expo push tokens — skipping send");
    return;
  }

  const messages: ExpoPushMessage[] = validTokens.map((to) => ({
    to,
    sound: "default" as const,
    title,
    body,
    data: data ?? {},
    priority: "high",
    channelId: "default",
  }));

  const chunks = expo.chunkPushNotifications(messages);

  // Map receiptId → original token so we can clean up invalid tokens later
  const tokenByReceiptId = new Map<ExpoPushReceiptId, string>();
  // Build a map from token → message position for receipt tracking
  const tokenIndex = new Map(validTokens.map((t, i) => [t, i]));

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);

      let successCount = 0;
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const token = (chunk[i] as ExpoPushMessage).to as string;

        if (ticket.status === "ok") {
          successCount++;
          if (ticket.id) {
            tokenByReceiptId.set(ticket.id, token);
          }
        } else {
          // Immediate error ticket
          const details = (ticket as { details?: { error?: string } }).details;
          logger.warn(
            { token: token.slice(-8), error: ticket.message, details },
            "Push ticket error",
          );
          if (details?.error === "DeviceNotRegistered") {
            // Clean up immediately without waiting for receipts
            void removeStaleTokenFromSupabase(token);
          }
        }
      }
      logger.info({ sent: successCount, total: chunk.length }, "Push chunk sent");
    } catch (err) {
      logger.error({ err }, "Failed to send push notification chunk");
    }
  }

  // Step 2: check receipts after 30 s (Expo recommends waiting before polling)
  if (tokenByReceiptId.size > 0) {
    const receiptIds = Array.from(tokenByReceiptId.keys());
    setTimeout(() => {
      checkReceipts(receiptIds, tokenByReceiptId).catch((err) =>
        logger.error({ err }, "Receipt check failed"),
      );
    }, 30_000);
    logger.info({ receiptCount: receiptIds.length }, "Receipt check scheduled in 30 s");
  }
}
