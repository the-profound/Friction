import { describe, expect, it } from "vitest";
import { getSpaceCreationDiagnostic } from "./spaceCreationDiagnostics";

describe("space creation diagnostics", () => {
  it("keeps only safe anonymous-space submission details", () => {
    const diagnostic = getSpaceCreationDiagnostic(
      "space",
      {
        "x-friction-client-platform": "ios",
        "x-friction-release-track": "preview",
        "x-friction-release-fingerprint": "0123456789abcdef",
      },
      { isAnonymous: true, spaceNickname: "달빛" },
    );

    expect(diagnostic).toEqual({
      stage: "space",
      isAnonymous: true,
      spaceNicknameIncluded: true,
      spaceNicknameLength: 2,
      clientPlatform: "ios",
      releaseTrack: "preview",
      configurationFingerprint: "0123456789abcdef",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("달빛");
  });

  it("retains real-name requests without requiring or recording a nickname", () => {
    expect(
      getSpaceCreationDiagnostic(
        "space",
        { "x-friction-client-platform": "web" },
        { isAnonymous: false },
      ),
    ).toMatchObject({
      isAnonymous: false,
      spaceNicknameIncluded: false,
      spaceNicknameLength: null,
      clientPlatform: "web",
    });
  });

  it("accepts only safe release and round retry headers", () => {
    expect(
      getSpaceCreationDiagnostic(
        "round",
        {
          "x-friction-space-anonymous": "true",
          "x-friction-space-nickname-included": "true",
          "x-friction-space-nickname-length": "20",
          "x-friction-release-track": "production",
          "x-friction-release-fingerprint": "not-a-token",
        },
        { roundNumber: 2 },
      ),
    ).toMatchObject({
      stage: "round",
      isAnonymous: true,
      spaceNicknameIncluded: true,
      spaceNicknameLength: 20,
      releaseTrack: "production",
      configurationFingerprint: null,
    });
  });
});