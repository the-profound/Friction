import { describe, expect, it } from "vitest";
import { redactSpaceCreationKeys } from "./spaceCreationResponse";

describe("space creation response redaction", () => {
  it("removes internal creation keys from direct and nested API responses", () => {
    const response = {
      id: "space-1",
      creationKey: "sc_abc123def456ghi789",
      space: {
        id: "space-2",
        creationKey: "sc_zyx987wvu654tsr321",
      },
      rows: [{ creationKey: "sc_qwe123rty456uio789", name: "공간" }],
    };

    const redacted = redactSpaceCreationKeys(response);
    expect(redacted).toEqual({
      id: "space-1",
      space: { id: "space-2" },
      rows: [{ name: "공간" }],
    });
    expect(JSON.stringify(redacted)).not.toContain("sc_");
  });
});