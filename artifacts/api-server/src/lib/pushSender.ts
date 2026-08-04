/**
 * Expo Push Notification sender.
 *
 * Wraps the expo-server-sdk to send silent push notifications.
 * Cleans up DeviceNotRegistered tokens from the DB automatically.
 */
import Expo, { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

// Singleton Expo client
const expo = new Expo();

export interface SilentPushTarget {
  userId: string;
  token: string;
  platform: string;
}

export interface PushSendResult {
  userId: string;
  token: string;
  success: boolean;
  error?: string;
}

/**
 * Sends a silent push notification to the given tokens.
 *
 * iOS:  sound: null, interruption-level: passive (via APNs extras)
 * Android: channelId 'letter-arrived-silent', priority 'normal', sound: null
 *
 * DeviceNotRegistered tokens are removed from the DB.
 */
export async function sendSilentPush(
  targets: SilentPushTarget[],
  body: string,
  data?: Record<string, unknown>,
): Promise<PushSendResult[]> {
  const validTargets = targets.filter((t) => Expo.isExpoPushToken(t.token));
  const skipped = targets.filter((t) => !Expo.isExpoPushToken(t.token));

  if (skipped.length > 0) {
    logger.warn(
      { count: skipped.length },
      "pushSender: skipping invalid Expo push tokens",
    );
  }

  if (validTargets.length === 0) return [];

  const messages: ExpoPushMessage[] = validTargets.map((t) => {
    const base: ExpoPushMessage = {
      to: t.token,
      body,
      data: data ?? {},
      sound: undefined, // no sound
      badge: 0,
    };

    if (t.platform === "ios") {
      return {
        ...base,
        // APNs passive interruption level — delivered silently to notification center
        // Expo SDK v7 uses `interruptionLevel` (not `_interruptionLevel`)
        interruptionLevel: "passive" as const,
      };
    }

    // Android
    return {
      ...base,
      channelId: "letter-arrived-silent",
      priority: "normal",
    };
  });

  const chunks = expo.chunkPushNotifications(messages);
  const results: PushSendResult[] = [];
  const invalidTokens: string[] = [];

  // Track the offset into validTargets so each chunk's ticket[i] maps to
  // the correct target (a chunk contains up to 100 messages).
  let targetOffset = 0;

  for (const chunk of chunks) {
    const chunkTargets = validTargets.slice(targetOffset, targetOffset + chunk.length);
    targetOffset += chunk.length;

    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      logger.error({ err }, "pushSender: chunk send failed");
      for (const t of chunkTargets) {
        results.push({ userId: t.userId, token: t.token, success: false, error: "chunk_send_failed" });
      }
      continue;
    }

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]!;
      const target = chunkTargets[i]!;

      if (ticket.status === "ok") {
        results.push({ userId: target.userId, token: target.token, success: true });
      } else {
        const errDetails = ticket.details?.error;
        results.push({
          userId: target.userId,
          token: target.token,
          success: false,
          error: errDetails ?? "unknown",
        });

        if (errDetails === "DeviceNotRegistered") {
          invalidTokens.push(target.token);
        }
      }
    }
  }

  // Clean up stale DeviceNotRegistered tokens
  if (invalidTokens.length > 0) {
    try {
      await db
        .delete(pushTokensTable)
        .where(inArray(pushTokensTable.token, invalidTokens));
      logger.info(
        { count: invalidTokens.length },
        "pushSender: removed DeviceNotRegistered tokens",
      );
    } catch (err) {
      logger.error({ err }, "pushSender: failed to remove stale tokens");
    }
  }

  return results;
}
