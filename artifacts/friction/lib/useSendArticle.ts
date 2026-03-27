import { useCallback } from "react";
import { useSendArticle as useSendArticleMutation } from "@workspace/api-client-react";
import { canSendArticle, canSendToNeighbor, getNextDeliverySlot, formatDeliveryTime } from "./deliverySync";
import type { ArticleStatus } from "./policies";

export interface SendResult {
  success: boolean;
  error?: string;
  deliveryTime?: string;
}

export interface UseSendArticleOptions {
  senderId: string;
}

export function useSendArticleFlow({ senderId }: UseSendArticleOptions) {
  const sendMutation = useSendArticleMutation();

  const send = useCallback(
    async (
      articleId: string,
      articleStatus: ArticleStatus,
      recipientId: string,
      isNeighbor: boolean,
    ): Promise<SendResult> => {
      const guard = canSendToNeighbor(articleStatus, senderId, recipientId, isNeighbor);
      if (!guard.allowed) {
        return { success: false, error: guard.reason };
      }

      try {
        await sendMutation.mutateAsync({
          data: { senderId, recipientId, articleId },
        });

        const { visibleAt } = getNextDeliverySlot();
        const deliveryTime = formatDeliveryTime(visibleAt);
        return { success: true, deliveryTime };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "발송에 실패했습니다.";
        return { success: false, error: msg };
      }
    },
    [senderId, sendMutation],
  );

  const checkCanSend = useCallback(
    (articleStatus: ArticleStatus, recipientId: string): { allowed: boolean; reason?: string } => {
      return canSendArticle(articleStatus, senderId, recipientId);
    },
    [senderId],
  );

  const getExpectedDeliveryTime = useCallback((): string => {
    const { visibleAt } = getNextDeliverySlot();
    return formatDeliveryTime(visibleAt);
  }, []);

  return {
    send,
    checkCanSend,
    getExpectedDeliveryTime,
    isSending: sendMutation.isPending,
  };
}
