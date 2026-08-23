import { describe, expect, it, vi } from "vitest";
import { getListArticlesQueryKey, getListThoughtsQueryKey } from "@workspace/api-client-react";

import { invalidateDirectThoughtCreation } from "../queryInvalidation";

describe("direct thought creation cache invalidation", () => {
  it("refreshes both records sources when returning from a new thought", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries };

    await invalidateDirectThoughtCreation(queryClient as never);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListArticlesQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListThoughtsQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});