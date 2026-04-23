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
}

export const searchUsersByNicknameUrl = (nickname: string, userId: string) =>
  `/api/users/search?nickname=${encodeURIComponent(nickname)}&userId=${encodeURIComponent(userId)}`;

export const searchUsersByNickname = async (
  nickname: string,
  userId: string,
  options?: RequestInit,
): Promise<UserSearchResult[]> => {
  return customFetch<UserSearchResult[]>(searchUsersByNicknameUrl(nickname, userId), {
    ...options,
    method: "GET",
  });
};

export const getSearchUsersByNicknameQueryKey = (nickname: string, userId: string) =>
  ["users", "search", nickname, userId] as const;

export const useSearchUsersByNickname = (
  nickname: string,
  userId: string,
  options?: Omit<UseQueryOptions<UserSearchResult[]>, "queryKey" | "queryFn" | "enabled">,
): UseQueryResult<UserSearchResult[]> => {
  return useQuery({
    queryKey: getSearchUsersByNicknameQueryKey(nickname, userId),
    queryFn: () => searchUsersByNickname(nickname, userId),
    enabled: nickname.trim().length > 0 && userId.length > 0,
    ...options,
  });
};
