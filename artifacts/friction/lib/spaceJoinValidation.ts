export const SPACE_NICKNAME_MAX_LENGTH = 20;

export function validateSpaceNickname(value: string): string | null {
  const nickname = value.trim();
  if (!nickname) return "공간 닉네임을 입력해주세요.";
  if (nickname.length > SPACE_NICKNAME_MAX_LENGTH) {
    return `공간 닉네임은 ${SPACE_NICKNAME_MAX_LENGTH}자까지 입력할 수 있어요.`;
  }
  return null;
}
