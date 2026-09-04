export type ReturnRoute = "(tabs)" | "on-01a" | string;

export interface ReturnStackState {
  routes: ReturnRoute[];
  visibleHistory: ReturnRoute[];
  dispatchCount: number;
}

/**
 * Owns one screen-exit attempt from its first accepted trigger through the
 * navigation commit. Intercepted removals and app-initiated exits deliberately
 * use different commit methods so they can never both move the route.
 */
export class GuardedReturnSession<Action> {
  private phase: "idle" | "saving" | "committed" | "disposed" = "idle";
  private generation = 0;
  private pendingExplicit: { generation: number; navigate: () => void } | null = null;

  begin(): boolean {
    if (this.phase !== "idle") return false;
    this.phase = "saving";
    return true;
  }

  retry(): void {
    if (this.phase === "saving") this.phase = "idle";
  }

  commitIntercepted(action: Action, dispatch: (action: Action) => void): boolean {
    if (this.phase !== "saving") return false;
    this.phase = "committed";
    this.generation += 1;
    dispatch(action);
    return true;
  }

  prepareExplicit(navigate: () => void): number | null {
    // Stage/entity replacements already hold the screen's action lock and call
    // this only after their own durability boundary. Admit that explicit path
    // directly while still rejecting every later owner.
    if (this.phase === "idle") this.phase = "saving";
    if (this.phase !== "saving") return null;
    this.phase = "committed";
    this.generation += 1;
    this.pendingExplicit = { generation: this.generation, navigate };
    return this.generation;
  }

  consumeExplicit(generation: number): boolean {
    const pending = this.pendingExplicit;
    if (
      this.phase !== "committed"
      || !pending
      || pending.generation !== generation
      || this.generation !== generation
    ) {
      return false;
    }
    this.pendingExplicit = null;
    pending.navigate();
    return true;
  }

  resetAfterRouteChange(): boolean {
    if (this.phase !== "committed" || this.pendingExplicit) return false;
    this.phase = "idle";
    return true;
  }

  dispose(): void {
    this.phase = "disposed";
    this.generation += 1;
    this.pendingExplicit = null;
  }
}

export function createReturnStack(routes: ReturnRoute[]): ReturnStackState {
  return {
    routes: [...routes],
    visibleHistory: routes.length ? [routes[routes.length - 1]] : [],
    dispatchCount: 0,
  };
}

export function popReturnStack(state: ReturnStackState): void {
  state.dispatchCount += 1;
  if (state.routes.length > 1) state.routes.pop();
  const visible = state.routes[state.routes.length - 1];
  if (visible) state.visibleHistory.push(visible);
}

export function replaceReturnStack(state: ReturnStackState, route: ReturnRoute): void {
  state.dispatchCount += 1;
  if (state.routes.length) state.routes[state.routes.length - 1] = route;
  else state.routes.push(route);
  state.visibleHistory.push(route);
}