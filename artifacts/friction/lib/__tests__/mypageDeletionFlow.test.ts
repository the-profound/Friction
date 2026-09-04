import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const mypage = readFileSync(join(appRoot, "app/mypage.tsx"), "utf8");
const confirmModal = readFileSync(
  join(appRoot, "components/ConfirmModal/ConfirmModal.tsx"),
  "utf8",
);
const deleteHandler = mypage.match(
  /async function handleDeleteConfirm\(\) \{([\s\S]*?)\n  \}\n\n  function openUrl/,
)?.[1];

if (!deleteHandler) {
  throw new Error("Missing my page deletion handler");
}

describe("my page account deletion flow", () => {
  it("authenticates the deletion request and synchronously rejects duplicate confirms", () => {
    expect(mypage).toContain("const deleteSubmissionLockRef = useRef(createSubmissionLock());");
    expect(mypage).toContain("const deleteRequestDispatchedRef = useRef(false);");
    expect(mypage).toContain("if (!deleteSubmissionLockRef.current.tryAcquire()) return;");
    expect(mypage).toMatch(
      /runAuthenticatedMutation\(\{[\s\S]*?prepareSession: prepareAuthSession,[\s\S]*?deleteUserMutation\.mutateAsync\(\{ id: userId \}\)/,
    );
    expect(mypage).toContain("deleteSubmissionLockRef.current.release();");
  });

  it("keeps a failed deletion retryable in the modal with an actionable error", () => {
    expect(mypage).toContain("const [deleteError, setDeleteError] = useState<string | null>(null);");
    expect(mypage).toContain('deleteError ?? "탈퇴하면 모든 데이터가 삭제되며 복구할 수 없습니다."');
    expect(mypage).toContain("인터넷 연결을 확인한 뒤 탈퇴하기를 다시 눌러주세요.");
    expect(mypage).toContain("잠시 후 탈퇴하기를 다시 시도해주세요.");
    expect(deleteHandler).not.toContain("catch {\n      setDeleteModalVisible(false);");
  });

  it("converges to logged out after an ambiguous deletion loses auth on retry", () => {
    expect(deleteHandler).toContain("deleteRequestDispatchedRef.current = true;");
    expect(deleteHandler).toMatch(
      /error instanceof AuthSessionUnavailableError[\s\S]*?deleteRequestDispatchedRef\.current[\s\S]*?await signOut\(\)\.catch\(\(\) => undefined\);[\s\S]*?queryClient\.clear\(\);[\s\S]*?setDeleteModalVisible\(false\);[\s\S]*?router\.replace\(\"\/login\" as never\);/,
    );
  });

  it("disables every dismissal path while processing and exposes its busy state", () => {
    expect(mypage).toContain("confirmDisabled={isDeleting}");
    expect(mypage).toContain("cancelDisabled={isDeleting}");
    expect(mypage).toContain("onBackdropPress={() => {");
    expect(confirmModal).toContain(
      "onPress={cancelDisabled ? undefined : (onBackdropPress ?? onCancel)}",
    );
    expect(confirmModal).toContain(
      "onRequestClose={cancelDisabled ? () => undefined : (onBackdropPress ?? onCancel)}",
    );
    expect(confirmModal).toContain(
      "accessibilityState={{ disabled: confirmDisabled, busy: confirmDisabled }}",
    );
    expect(confirmModal).toContain(
      "accessibilityState={{ disabled: cancelDisabled, busy: cancelDisabled }}",
    );
  });

  it("clears local auth only after the server confirms deletion, then routes to login", () => {
    const mutation = deleteHandler.indexOf("await runAuthenticatedMutation");
    const signOut = deleteHandler.indexOf(
      "await signOut().catch(() => undefined);",
      mutation,
    );
    const clear = deleteHandler.indexOf("queryClient.clear();", signOut);
    const login = deleteHandler.indexOf('router.replace("/login" as never);', clear);

    expect(mutation).toBeGreaterThan(-1);
    expect(signOut).toBeGreaterThan(mutation);
    expect(clear).toBeGreaterThan(signOut);
    expect(login).toBeGreaterThan(clear);
    expect(deleteHandler).toContain("await signOut().catch(() => undefined);");
  });
});