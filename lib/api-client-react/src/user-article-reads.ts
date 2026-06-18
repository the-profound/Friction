import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { UserArticleRead } from "./generated/api.schemas";

export interface ListUserArticleReadsParams {
  userId: string;
}

export const getListUserArticleReadsUrl = (params: ListUserArticleReadsParams) => {
  return `/api/user-article-reads?userId=${encodeURIComponent(params.userId)}`;
};

export const listUserArticleReads = async (
  params: ListUserArticleReadsParams,
  options?: RequestInit,
): Promise<UserArticleRead[]> => {
  return customFetch<UserArticleRead[]>(getListUserArticleReadsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getListUserArticleReadsQueryKey = (params: ListUserArticleReadsParams) =>
  ["/api/user-article-reads", params] as const;

export const useListUserArticleReads = (
  params: ListUserArticleReadsParams,
  options?: Omit<UseQueryOptions<UserArticleRead[]>, "queryKey" | "queryFn" | "enabled">,
): UseQueryResult<UserArticleRead[]> & { queryKey: readonly unknown[] } => {
  const queryKey = getListUserArticleReadsQueryKey(params);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => listUserArticleReads(params, { signal }),
    enabled: !!params.userId,
    ...options,
  });
  return { ...query, queryKey };
};
