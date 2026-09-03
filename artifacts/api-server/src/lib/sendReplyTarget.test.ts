import { describe, expect, it } from "vitest";

import { resolveReplyTarget } from "./sendReplyTarget";

describe("reply send target resolution", () => {
  it("uses the exact selected inbox when the same article was received from different senders", () => {
    const repeatedArticleInboxes = [
      {
        id: "newer-inbox",
        articleId: "shared-article",
        senderId: "newer-sender",
      },
      {
        id: "selected-older-inbox",
        articleId: "shared-article",
        senderId: "selected-sender",
      },
    ];
    const selectedInbox = repeatedArticleInboxes[1];

    expect(resolveReplyTarget("recipient", selectedInbox)).toEqual({
      recipientId: "selected-sender",
      replyToInboxId: "selected-older-inbox",
    });
  });
});