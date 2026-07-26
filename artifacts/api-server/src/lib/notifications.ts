/**
 * Notification dispatch layer.
 *
 * This module is the single entry point for all in-app / push notification
 * events in the API server.  It currently logs structured events via pino so
 * that an external consumer (Expo Push, APNs, FCM, etc.) can subscribe to the
 * log stream and deliver the payload.
 *
 * When a real push-delivery backend is ready, wire it in here — callers
 * (route handlers, the scheduler) never need to change.
 */
import { logger } from "./logger";

export type NotificationEvent =
  | {
      type: "SPACE_CODE_REQUEST_AUTO_REJECTED";
      spaceId: string;
      requesterId: string;
      rejectionReason: string;
    }
  | {
      type: "SPACE_OPERATOR_NOT_STARTED_ALERT";
      spaceId: string;
      operatorId: string;
      daysOverdue: number;
    }
  | {
      type: "SPACE_PARTICIPANT_NOT_STARTED_14DAY";
      spaceId: string;
      participantIds: string[];
      daysOverdue: number;
    }
  | {
      type: "SPACE_OPERATOR_ACTION_REQUIRED_14DAY";
      spaceId: string;
      operatorId: string;
      daysOverdue: number;
      options: ("ARCHIVE" | "EXTEND_PLANNED_STARTS_AT")[];
    };

/**
 * Dispatch a notification event to all relevant recipients.
 *
 * Until external push is integrated, this emits a structured pino log event
 * that can be picked up by a log-consumer sidecar / webhook.
 * TODO: add Expo Push SDK call once device tokens are stored.
 */
export function dispatchNotification(event: NotificationEvent): void {
  logger.info({ notification: event }, `notification:${event.type}`);
}
