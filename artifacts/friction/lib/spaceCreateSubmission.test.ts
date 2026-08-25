import { describe, expect, it } from "vitest";
import {
  buildSpaceCreateSubmission,
  getSpaceCreationDiagnosticContext,
  getSpaceCreationFailureMessage,
  getSpaceCreationSubmissionDiagnostic,
} from "./spaceCreateSubmission";

const baseInput = {
  name: "  여름 읽기 모임  ",
  description: "  함께 읽어요  ",
  plannedStartsAt: "2026-08-28T00:00:00.000Z",
  roundCount: 3,
  maxParticipants: null,
  defaultCenterInterval: 1,
  defaultCenterCount: 1,
  scheduleType: "N_DAY" as const,
  weekdays: null,
  operatorParticipates: true,
  spaceNickname: "  달빛  ",
  creationKey: "sc_abc123def456ghi789",
};

describe("space creation submission", () => {
  it("sends a real-name space as isAnonymous=false without a space nickname", () => {
    const submission = buildSpaceCreateSubmission({
      ...baseInput,
      isAnonymous: false,
      creationKey: "sc_abc123def456ghi789",
    });

    expect(submission).toMatchObject({
      name: "여름 읽기 모임",
      description: "함께 읽어요",
      isAnonymous: false,
    });
    expect(submission).not.toHaveProperty("spaceNickname");
  });

  it("sends an anonymous space with its trimmed space nickname", () => {
    const submission = buildSpaceCreateSubmission({
      ...baseInput,
      isAnonymous: true,
    });

    expect(submission).toMatchObject({
      isAnonymous: true,
      spaceNickname: "달빛",
      creationKey: "sc_abc123def456ghi789",
    });
  });

  it("logs only nickname presence and length, never its contents", () => {
    const submission = buildSpaceCreateSubmission({
      ...baseInput,
      isAnonymous: true,
    });
    const diagnostic = getSpaceCreationSubmissionDiagnostic(
      submission,
      getSpaceCreationDiagnosticContext(
        { track: "preview", configurationFingerprint: "0123456789abcdef" },
        "ios",
      ),
    );

    expect(diagnostic).toEqual({
      isAnonymous: true,
      spaceNicknameIncluded: true,
      spaceNicknameLength: 2,
      platform: "ios",
      releaseTrack: "preview",
      configurationFingerprint: "0123456789abcdef",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("달빛");
  });

  it("makes a post-space round failure actionable", () => {
    expect(getSpaceCreationFailureMessage("round")).toContain("공간은 만들어졌지만");
    expect(getSpaceCreationFailureMessage("space", 409)).toContain("닉네임");
  });
});