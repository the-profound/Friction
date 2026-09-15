import { describe, expect, it } from "vitest";
import { ANONYMOUS_PARTICIPANT_NAME } from "./anonymousSpaceIdentity";
import { resolveMyCollectionArticleAuthorIdentity } from "./myCollectionArticleIdentity";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_AUTHOR = "20000000-0000-4000-8000-000000000002";

describe("resolveMyCollectionArticleAuthorIdentity", () => {
  it("never masks the collection owner's own letter, even from an anonymous space", () => {
    const result = resolveMyCollectionArticleAuthorIdentity({
      articleAuthorId: OWNER,
      collectionOwnerId: OWNER,
      rawAuthorNickname: "실명",
      spaceIsAnonymous: true,
      spaceAuthorSpaceNickname: "달빛",
    });
    expect(result).toEqual({ authorNickname: "실명", authorIdentityMasked: false });
  });

  it("masks a foreign author's letter from an anonymous space using their space nickname", () => {
    const result = resolveMyCollectionArticleAuthorIdentity({
      articleAuthorId: OTHER_AUTHOR,
      collectionOwnerId: OWNER,
      rawAuthorNickname: "실명",
      spaceIsAnonymous: true,
      spaceAuthorSpaceNickname: "달빛",
    });
    expect(result).toEqual({ authorNickname: "달빛", authorIdentityMasked: true });
  });

  it("falls back to the safe participant label when no space nickname was chosen yet", () => {
    const result = resolveMyCollectionArticleAuthorIdentity({
      articleAuthorId: OTHER_AUTHOR,
      collectionOwnerId: OWNER,
      rawAuthorNickname: "실명",
      spaceIsAnonymous: true,
      spaceAuthorSpaceNickname: null,
    });
    expect(result).toEqual({ authorNickname: ANONYMOUS_PARTICIPANT_NAME, authorIdentityMasked: true });
  });

  it("shows the real nickname for a foreign author whose space is not anonymous", () => {
    const result = resolveMyCollectionArticleAuthorIdentity({
      articleAuthorId: OTHER_AUTHOR,
      collectionOwnerId: OWNER,
      rawAuthorNickname: "실명",
      spaceIsAnonymous: false,
      spaceAuthorSpaceNickname: null,
    });
    expect(result).toEqual({ authorNickname: "실명", authorIdentityMasked: false });
  });

  it("shows the real nickname for a foreign author when the article never went through a space", () => {
    const result = resolveMyCollectionArticleAuthorIdentity({
      articleAuthorId: OTHER_AUTHOR,
      collectionOwnerId: OWNER,
      rawAuthorNickname: "실명",
      spaceIsAnonymous: null,
      spaceAuthorSpaceNickname: null,
    });
    expect(result).toEqual({ authorNickname: "실명", authorIdentityMasked: false });
  });

  it("treats an unknown collection owner as unsafe to declare self-authored", () => {
    const result = resolveMyCollectionArticleAuthorIdentity({
      articleAuthorId: OTHER_AUTHOR,
      collectionOwnerId: null,
      rawAuthorNickname: "실명",
      spaceIsAnonymous: true,
      spaceAuthorSpaceNickname: "달빛",
    });
    expect(result).toEqual({ authorNickname: "달빛", authorIdentityMasked: true });
  });
});
