import { requireNativeModule, type EventSubscription } from "expo-modules-core";

interface TextSelectionMenuModule {
  activate(showMemo: boolean): void;
  deactivate(): void;
  addListener(eventName: string, listener: (...args: any[]) => void): EventSubscription;
}

let _module: TextSelectionMenuModule | null = null;

try {
  _module = requireNativeModule<TextSelectionMenuModule>("TextSelectionMenu");
} catch {
  if (__DEV__) {
    console.warn(
      "[TextSelectionMenu] Native module unavailable. " +
      "수집/메모 will not appear in the OS text selection menu. " +
      "Use a development build (EAS Build) instead of Expo Go to enable this feature.",
    );
  }
}

export const isAvailable = _module !== null;

export function activate(showMemo: boolean = true): void {
  _module?.activate(showMemo);
}

export function deactivate(): void {
  _module?.deactivate();
}

export function addCollectListener(callback: () => void): EventSubscription | null {
  return _module?.addListener("onCollect", callback) ?? null;
}

export function addMemoListener(callback: () => void): EventSubscription | null {
  return _module?.addListener("onMemo", callback) ?? null;
}
