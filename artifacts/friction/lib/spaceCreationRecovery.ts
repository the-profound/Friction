import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_SPACE_CREATION_KEY = "friction:pendingSpaceCreationKey";

export function createSpaceCreationKey(): string {
  const entropy = Math.random().toString(36).slice(2, 14);
  return `sc_${Date.now().toString(36)}${entropy}`.slice(0, 63);
}

export function getPendingSpaceCreationKey(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_SPACE_CREATION_KEY);
}

export function savePendingSpaceCreationKey(key: string): Promise<void> {
  return AsyncStorage.setItem(PENDING_SPACE_CREATION_KEY, key);
}

export function clearPendingSpaceCreationKey(): Promise<void> {
  return AsyncStorage.removeItem(PENDING_SPACE_CREATION_KEY);
}