import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export type UserSearchStatus = "none" | "neighbor" | "pending";

export interface UserSearchResult {
  id: string;
  nickname: string;
  email: string;
  avatarUrl?: string | null;
  status: UserSearchStatus;
  requestId?: string;
}

export interface SearchUsersOptions {
  excludeTeamId?: string;
}

export const searchUsersByNicknameUrl = (nickname: string, userId: string, options?: SearchUsersOptions) => {
  let url = `/api/users/search?nickname=${encodeURIComponent(nickname)}&userId=${encodeURIComponent(userId)}`;
  if (options?.excludeTeamId) {
    url += `&excludeTeamId=${encodeURIComponent(options.excludeTeamId)}`;
  }
  return url;
};

export const searchUsersByNickname = async (
  nickname: string,
  userId: string,
  options?: SearchUsersOptions & RequestInit,
): Promise<UserSearchResult[]> => {
  const { excludeTeamId, ...fetchOptions } = options ?? {};
  return customFetch<UserSearchResult[]>(searchUsersByNicknameUrl(nickname, userId, { excludeTeamId }), {
    ...fetchOptions,
    method: "GET",
  });
};

export const getSearchUsersByNicknameQueryKey = (nickname: string, userId: string, options?: SearchUsersOptions) =>
  ["users", "search", nickname, userId, options?.excludeTeamId ?? null] as const;

export const useSearchUsersByNickname = (
  nickname: string,
  userId: string,
  options?: SearchUsersOptions & Omit<UseQueryOptions<UserSearchResult[]>, "queryKey" | "queryFn" | "enabled">,
): UseQueryResult<UserSearchResult[]> => {
  const { excludeTeamId, ...queryOptions } = options ?? {};
  return useQuery({
    queryKey: getSearchUsersByNicknameQueryKey(nickname, userId, { excludeTeamId }),
    queryFn: () => searchUsersByNickname(nickname, userId, { excludeTeamId }),
    enabled: nickname.trim().length > 0 && userId.length > 0,
    ...queryOptions,
  });
};
