export interface ReplySourceInbox {
  id: string;
  senderId: string;
}

export function resolveReplyTarget(
  senderId: string,
  sourceInbox: ReplySourceInbox | null | undefined,
) {
  if (!sourceInbox) {
    throw Object.assign(new Error("답장하려면 읽은 편지를 선택해야 합니다."), {
      statusCode: 400,
    });
  }
  if (sourceInbox.senderId === senderId) {
    throw Object.assign(new Error("자신이 보낸 편지에는 답장할 수 없습니다."), {
      statusCode: 400,
    });
  }
  return {
    recipientId: sourceInbox.senderId,
    replyToInboxId: sourceInbox.id,
  };
}