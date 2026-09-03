import { resolveInboxSourceName } from "./inboxSource";

export type InboxPrivacyRow = {
  sender?: unknown;
  isAnonymousSpace: boolean | null;
  explicitSpaceName: string | null;
  scheduledSpaceName: string | null;
  legacyScheduledSpaceName: string | null;
  teamCollectionName: string | null;
  personalCollectionName: string | null;
  [key: string]: unknown;
};

/**
 * Removes internal source-resolution fields and strips the account-level sender
 * object from anonymous space deliveries. `senderDisplayName` remains the sole
 * display identity returned by the route.
 */
export function sanitizeInboxPrivacy<T extends InboxPrivacyRow>(row: T) {
  const {
    isAnonymousSpace,
    explicitSpaceName,
    scheduledSpaceName,
    legacyScheduledSpaceName,
    teamCollectionName,
    personalCollectionName,
    ...item
  } = row;

  return {
    ...item,
    collectionName: resolveInboxSourceName({
      explicitSpaceName,
      scheduledSpaceName,
      legacyScheduledSpaceName,
      teamCollectionName,
      personalCollectionName,
    }),
    ...(isAnonymousSpace ? { sender: undefined } : {}),
  };
}