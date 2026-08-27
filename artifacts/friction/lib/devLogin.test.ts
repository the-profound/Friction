import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const frictionRoot = join(__dirname, "..");
const read = (relativePath: string) =>
  readFileSync(join(frictionRoot, relativePath), "utf8");

describe("development login account", () => {
  it("directs unavailable Minji simulation login to provisioned accounts", () => {
    const login = read("app/login.tsx");
    const seed = read("../api-server/src/seed.ts");

    expect(login).toContain(
      '"민지 테스트 계정은 아직 인증 서버에 준비되지 않았어요. 현준 또는 일곤 버튼으로 로그인해주세요."',
    );
    expect(login).toContain("onPress={handleHyeonjunLogin}");
    expect(login).toContain("onPress={handleIlgonLogin}");
    expect(seed).toContain("'92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f','minji@test.dev'");
  });
});