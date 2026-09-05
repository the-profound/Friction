export type InboxQueryState = {
  isOnline: boolean;
  isPending: boolean;
  hasData: boolean;
};

export function shouldShowInboxOfflineEmptyNotice({
  isOnline,
  isPending,
  hasData,
}: InboxQueryState): boolean {
  return !isOnline && isPending && !hasData;
}