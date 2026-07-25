/**
 * Push notification service using Expo Push Notification API.
 *
 * Note: Expo's push service is free but has practical rate limits.
 * At large scale (many thousands of users), consider a dedicated
 * push infrastructure (FCM/APNs directly).
 */

import Expo, { type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { logger } from "./logger";

const expo = new Expo();

/**
 * Send push notifications to a list of Expo push tokens.
 * Automatically filters invalid tokens and batches requests.
 */
export async function sendPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));

  if (validTokens.length === 0) {
    return;
  }

  const messages: ExpoPushMessage[] = validTokens.map((to) => ({
    to,
    sound: "default" as const,
    title,
    body,
    data: data ?? {},
  }));

  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      const errorTickets = tickets.filter((t) => t.status === "error");
      if (errorTickets.length > 0) {
        logger.warn({ errorTickets }, "Some push notifications failed");
      } else {
        logger.info({ count: tickets.length }, "Push notifications sent successfully");
      }
    } catch (err) {
      logger.error({ err }, "Failed to send push notification chunk");
    }
  }
}
