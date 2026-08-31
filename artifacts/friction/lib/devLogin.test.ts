import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const frictionRoot = join(__dirname, "..");
const read = (relativePath: string) =>
  readFileSync(join(frictionRoot, relativePath), "utf8");

describe("development login account", () => {
  it("uses the provisioned Minji account with both password candidates", () => {
    const login = read("app/login.tsx");

    expect(login).toContain('const MINJI_EMAIL = "minji@test.com";');
    expect(login).toContain(
      'const MINJI_PASSWORD_CANDIDATES = ["00000000", "000000"] as const;',
    );
    expect(login).toContain("MINJI_EMAIL,\n            candidatePassword,");
    expect(login).toContain(
      "if (candidateIndex === 0 && isInvalidCredentialsError(error))",
    );
    expect(login).toContain("minjiLoginInFlightRef.current");
    expect(login).not.toContain(
      "민지 테스트 계정은 아직 인증 서버에 준비되지 않았어요",
    );
  });

  it("keeps the other development login buttons and regular login path", () => {
    const login = read("app/login.tsx");

    expect(login).toContain("onPress={handleHyeonjunLogin}");
    expect(login).toContain("onPress={handleIlgonLogin}");
    expect(login).toContain("signInWithPassword(email.trim(), password)");
    expect(login).toContain("onPress={handleDevLogin}");
  });

  it("does not retry after non-credential errors", () => {
    const login = read("app/login.tsx");
    const minjiHandler = login.slice(
      login.indexOf("async function handleDevLogin"),
      login.indexOf("async function handleHyeonjunLogin"),
    );

    expect(minjiHandler).toContain(
      "if (candidateIndex === 0 && isInvalidCredentialsError(error))",
    );
    expect(minjiHandler).toContain(
      "setErrorMessage(getLoginErrorMessage(error));",
    );
    expect(minjiHandler).toContain("return;");
  });
});
