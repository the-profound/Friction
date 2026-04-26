import { useEffect, useRef } from "react";

import { supabase } from "./supabase";
import { useScreenFocused } from "./useScreenFocused";

export type RealtimeChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface RealtimeBinding {
  /** PostgreSQL table name in the public schema, e.g. "inbox". */
  table: string;
  /**
   * Optional Supabase Realtime row filter expression, e.g.
   * `"recipient_id=eq.<uuid>"`. When omitted, all row events for the table
   * are watched (subject to RLS / publication scope on the database side).
   */
  filter?: string;
  /** Defaults to `"*"` so inserts/updates/deletes all trigger a refetch. */
  event?: RealtimeChangeEvent;
}

/**
 * Subscribes to Supabase Realtime `postgres_changes` while the current
 * screen is focused, invoking `onChange` whenever any matching row event
 * arrives. The subscription is torn down on blur/unmount, mirroring the
 * focus-gated polling lifecycle so it never runs in the background.
 *
 * The callback identity does not need to be stable — the hook stores the
 * latest reference in a ref so a fresh callback fires on every event without
 * triggering a re-subscription.
 *
 * `channelKey` must be unique per logical subscription on the screen so two
 * screens (or two hooks within the same screen) do not collide. Passing
 * `null` disables the subscription, which is useful while the user id is
 * still loading.
 *
 * If realtime is unavailable (network blocked, table not in the publication,
 * etc.) the hook silently no-ops — callers should keep a slower polling
 * interval as a safety net so updates still surface eventually.
 */
export function useRealtimeChannel(
  channelKey: string | null,
  bindings: RealtimeBinding[],
  onChange: () => void,
): void {
  const focused = useScreenFocused();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Stable serialization so React only re-subscribes when the logical
  // channel definition changes (table/filter/event), not on every render.
  const bindingsKey = JSON.stringify(bindings);

  useEffect(() => {
    if (!focused || !channelKey) return;

    let cancelled = false;
    const parsedBindings = JSON.parse(bindingsKey) as RealtimeBinding[];
    const channel = supabase.channel(channelKey);
    const handler = () => {
      if (!cancelled) onChangeRef.current();
    };

    for (const binding of parsedBindings) {
      const baseFilter = {
        schema: "public",
        table: binding.table,
        ...(binding.filter ? { filter: binding.filter } : {}),
      };
      // supabase-js exposes a separate `channel.on("postgres_changes", ...)`
      // overload per event literal, each with its own discriminated filter
      // type. Branching on the event keeps every call statically typed.
      switch (binding.event ?? "*") {
        case "INSERT":
          channel.on(
            "postgres_changes",
            { event: "INSERT", ...baseFilter },
            handler,
          );
          break;
        case "UPDATE":
          channel.on(
            "postgres_changes",
            { event: "UPDATE", ...baseFilter },
            handler,
          );
          break;
        case "DELETE":
          channel.on(
            "postgres_changes",
            { event: "DELETE", ...baseFilter },
            handler,
          );
          break;
        default:
          channel.on(
            "postgres_changes",
            { event: "*", ...baseFilter },
            handler,
          );
          break;
      }
    }

    channel.subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [focused, channelKey, bindingsKey]);
}
