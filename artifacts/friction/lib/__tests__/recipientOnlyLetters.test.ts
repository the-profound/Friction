import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "수신자만 볼 수 있는 편지" screen has no render harness (WebView/gesture-free,
// but relies on multiple live queries), so this locks in the inclusion logic
// and copy via the same raw-source-text convention used for other
// hard-to-render screens (see app/on-01a.tsx tests).
const appRoot = join(__dirname, "../..");
const readScreen = () =>
  readFileSync(join(appRoot, "app/user-profile/recipient-only-letters.tsx"), "utf8");
const readMypage = () => readFileSync(join(appRoot, "app/mypage.tsx"), "utf8");
const readUserProfile = () =>
  readFileSync(join(appRoot, "app/user-profile/[userId].tsx"), "utf8");

describe("recipient-only-letters screen", () => {
  it("includes personal/reply sends alongside space RECIPIENT_ONLY letters, excluding anything already PUBLIC", () => {
    const screen = readScreen();

    // Personal/reply sends never have a space_letter row and are always
    // recipient-only.
    expect(screen).toContain(
      'import {\n  buildSentLetterSourceMetadataByArticleId,\n  isSpaceSendRecord,\n} from "@/lib/sentLetterVisibility";',
    );
    expect(screen).toContain("personalSentArticleIds");
    expect(screen).toContain("isSpaceSendRecord(record)");

    // PUBLIC wins: a letter already public through any route must not appear here.
    expect(screen).toContain(
      'if (sl?.visibility === SpaceLetterVisibility.PUBLIC) return false;',
    );
    expect(screen).toContain(
      "return isSpaceRecipientOnly || personalSentArticleIds.has(a.id);",
    );
  });

  it("labels personal-send cards with their source name instead of falling back to a blank collectionName", () => {
    const screen = readScreen();

    expect(screen).toContain(
      "const collectionName = sendRecordByArticleId[article.id]?.name ?? vm.collectionName;",
    );
    expect(screen).toContain("collectionName={collectionName}");
  });

  it("re-fetches send records on focus so newly-sent personal letters appear promptly", () => {
    const screen = readScreen();

    expect(screen).toContain("const refetchSendRecords = sendRecordsQuery.refetch;");
    expect(screen).toContain("refetchSendRecords();");
  });

  it("describes the full recipient-only scope, not just space sends, in the header and empty state", () => {
    const screen = readScreen();

    expect(screen).toContain("수신자만 볼 수 있는 편지");
    expect(screen).not.toContain("수신자 공개 처리한 편지가 없어요");
    expect(screen).not.toContain("공간에서 보낸 편지를 수신자 공개로 설정하면");
  });

  it("keeps entry-point labels in mypage and the profile menu aligned with the new scope", () => {
    expect(readMypage()).toContain('label="수신자만 볼 수 있는 편지"');
    expect(readUserProfile()).toContain(
      "<Text style={styles.menuItemText}>수신자만 볼 수 있는 편지</Text>",
    );
  });
});
