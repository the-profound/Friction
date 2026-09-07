/**
 * Expo Push Notification sender.
 *
 * Wraps the expo-server-sdk to send standard (banner + sound) push
 * notifications. Cleans up DeviceNotRegistered tokens from the DB
 * automatically.
 */
import Expo, { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  createCorrelationId,
  logOperationalMetric,
} from "./operationalTelemetry";

// Singleton Expo client
const expo = new Expo();

export interface PushTarget {
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
 * Sends a standard (banner + sound) push notification to the given tokens.
 *
 * iOS: default interruption level, default sound — shows a banner and plays
 * a sound like any other notification.
 * Android: channelId 'letter-arrived' (must match the channel registered by
 * the client in app/_layout.tsx), priority 'high', default sound.
 *
 * DeviceNotRegistered tokens are removed from the DB.
 */
export async function sendPush(
  targets: PushTarget[],
  body: string,
  data?: Record<string, unknown>,
  options?: { correlationId?: string },
): Promise<PushSendResult[]> {
  const startedAt = performance.now();
  const correlationId = options?.correlationId ?? createCorrelationId();
  const validTargets = targets.filter((t) => Expo.isExpoPushToken(t.token));
  const skipped = targets.filter((t) => !Expo.isExpoPushToken(t.token));
  const skippedResults: PushSendResult[] = skipped.map((target) => ({
    userId: target.userId,
    token: target.token,
    success: false,
    error: "invalid_token",
  }));

  if (skipped.length > 0) {
    logger.warn(
      { count: skipped.length },
      "pushSender: skipping invalid Expo push tokens",
    );
  }

  if (validTargets.length === 0) {
    logOperationalMetric(logger, {
      operation: "push.send",
      outcome: skipped.length > 0 ? "degraded" : "success",
      durationMs: performance.now() - startedAt,
      correlationId,
      failureType: skipped.length > 0 ? "invalid_token" : undefined,
      count: targets.length,
      successCount: 0,
      failureCount: skipped.length,
    });
    return skippedResults;
  }

  const messages: ExpoPushMessage[] = validTargets.map((t) => {
    const base: ExpoPushMessage = {
      to: t.token,
      body,
      data: data ?? {},
      sound: "default",
      badge: 0,
    };

    if (t.platform === "ios") {
      // Default (active) interruption level — shows a banner and plays the
      // default sound like a normal notification.
      return base;
    }

    // Android — must match the 'letter-arrived' channel registered by the
    // client in app/_layout.tsx.
    return {
      ...base,
      channelId: "letter-arrived",
      priority: "high",
    };
  });

  const chunks = expo.chunkPushNotifications(messages);
  const results: PushSendResult[] = [...skippedResults];
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
      logger.error({ err, correlationId }, "pushSender: chunk send failed");
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
      logger.error({ err, correlationId }, "pushSender: failed to remove stale tokens");
    }
  }

  const successCount = results.filter((result) => result.success).length;
  const failureCount = results.length - successCount;
  logOperationalMetric(logger, {
    operation: "push.send",
    outcome: failureCount > 0 ? (successCount > 0 ? "degraded" : "failure") : "success",
    durationMs: performance.now() - startedAt,
    correlationId,
    failureType: failureCount > 0 ? "push_delivery_failed" : undefined,
    count: targets.length,
    successCount,
    failureCount,
  });

  return results;
}
