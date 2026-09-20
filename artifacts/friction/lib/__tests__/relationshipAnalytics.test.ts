import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("relationship analytics", () => {
  it("separates profile views, request attempts, and successful outcomes", () => {
    const analytics = read("lib/analytics.ts");
    expect(analytics).toContain('"relationship_profile_viewed"');
    expect(analytics).toContain('"neighbor_request_attempted"');
    expect(analytics).toContain('"neighbor_request_succeeded"');
    expect(analytics).toContain("relationship_key");
    expect(analytics).toContain("Math.imul(hash, 0x01000193)");
    expect(analytics).not.toContain("return [userAId, userBId].sort().join");
  });

  it("never sends profile names, email, or letter content", () => {
    const analytics = read("lib/analytics.ts");
    const relationshipSection = analytics.slice(
      analytics.indexOf("function relationshipKey"),
      analytics.indexOf("function appContext"),
    );
    expect(relationshipSection).not.toMatch(/\b(nickname|email|title|content)\s*:/);
  });

  it("records only successful request outcomes after the server mutation", () => {
    const profile = read("app/user-profile/[userId].tsx");
    expect(profile.indexOf("await createNeighborRequest.mutateAsync")).toBeLessThan(
      profile.indexOf("trackNeighborRequestSucceeded({"),
    );
    const neighbors = read("components/ToInline/NeighborsInline.tsx");
    expect(neighbors.indexOf("await acceptRequest.mutateAsync")).toBeLessThan(
      neighbors.indexOf("outcome: \"accepted\""),
    );
  });
});