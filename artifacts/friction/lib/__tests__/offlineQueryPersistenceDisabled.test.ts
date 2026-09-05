import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootLayoutSource = readFileSync(
  resolve(__dirname, "../../app/_layout.tsx"),
  "utf8",
);

describe("production startup query provider", () => {
  it("does not hydrate account-independent authenticated queries from disk", () => {
    expect(rootLayoutSource).toContain(
      "<QueryClientProvider client={queryClient}>",
    );
    expect(rootLayoutSource).not.toContain("<PersistQueryClientProvider");
    expect(rootLayoutSource).not.toContain("offlineQueryPersistOptions");
  });
});