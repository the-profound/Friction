import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { runtimeConfig } from "./runtimeConfig";
import { createNativeStorageAccessGate } from "./authSessionRecovery";

// `createClient` throws synchronously if either value is empty. Keep the
// module import safe, but make the missing configuration an explicit app
// state in AuthProvider instead of allowing the inert client to be used.
if (runtimeConfig.errorMessage) {
  console.warn(
    `[supabase] Invalid release configuration: ${runtimeConfig.issues.join(", ")}`,
  );
}

const supabaseUrl = runtimeConfig.supabaseUrl ?? "https://configuration.invalid";
const supabaseAnonKey = runtimeConfig.supabaseAnonKey ?? "configuration-invalid";
const CHUNK_SIZE = 1800;
const nativeStorageAccessGate = createNativeStorageAccessGate();

/**
 * The Supabase SDK initializes at module import time. AuthProvider opens this
 * gate only from the active native lifecycle path, before its explicit restore
 * reads SecureStore and classifies a refresh failure.
 */
export function activateNativeAuthStorage(): void {
  if (Platform.OS !== "web") nativeStorageAccessGate.open();
}

function chunkDataKey(key: string, index: number): string {
  return `${key}_chunk_${index}`;
}

function chunkCountKey(key: string): string {
  return `${key}_chunk_count`;
}

function encodeValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function decodeValue(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// SecureStore operations are TurboModule calls that can throw NSException on iOS
// if the keychain is temporarily unavailable or if the native module initializes
// on the wrong thread. All three helpers below catch those errors and return a
// safe value so Supabase session restoration degrades gracefully to "no session"
// rather than crashing the app.

async function secureGetChunked(key: string): Promise<string | null> {
  try {
    const countStr = await SecureStore.getItemAsync(chunkCountKey(key));

    if (countStr !== null && countStr !== undefined) {
      const count = parseInt(countStr, 10);
      if (isNaN(count) || count < 1) return null;

      const chunks: string[] = [];
      for (let i = 0; i < count; i++) {
        const chunk = await SecureStore.getItemAsync(chunkDataKey(key, i));
        if (chunk === null || chunk === undefined) return null;
        chunks.push(chunk);
      }

      try {
        return decodeValue(chunks.join(""));
      } catch {
        return null;
      }
    }

    const legacy = await SecureStore.getItemAsync(key);
    if (legacy !== null && legacy !== undefined) {
      await secureSetChunked(key, legacy);
      await SecureStore.deleteItemAsync(key);
      return legacy;
    }

    return null;
  } catch (err) {
    console.warn("[SecureStore] secureGetChunked failed — returning null:", err);
    return null;
  }
}

async function secureSetChunked(key: string, value: string): Promise<void> {
  try {
    const encoded = encodeValue(value);
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
      chunks.push(encoded.slice(i, i + CHUNK_SIZE));
    }
    if (chunks.length === 0) chunks.push("");

    const oldCountStr = await SecureStore.getItemAsync(chunkCountKey(key));
    const oldCount =
      oldCountStr !== null && oldCountStr !== undefined
        ? parseInt(oldCountStr, 10)
        : 0;

    await Promise.all(
      chunks.map((chunk, i) =>
        SecureStore.setItemAsync(chunkDataKey(key, i), chunk)
      )
    );
    await SecureStore.setItemAsync(chunkCountKey(key), String(chunks.length));

    const cleanOldCount = isNaN(oldCount) ? 0 : oldCount;
    for (let i = chunks.length; i < cleanOldCount; i++) {
      await SecureStore.deleteItemAsync(chunkDataKey(key, i));
    }
  } catch (err) {
    console.warn("[SecureStore] secureSetChunked failed — session will not persist:", err);
  }
}

async function secureDeleteChunked(key: string): Promise<void> {
  try {
    const countStr = await SecureStore.getItemAsync(chunkCountKey(key));
    const count =
      countStr !== null && countStr !== undefined
        ? parseInt(countStr, 10)
        : 0;

    const safeCount = isNaN(count) ? 0 : count;
    for (let i = 0; i < safeCount; i++) {
      await SecureStore.deleteItemAsync(chunkDataKey(key, i));
    }
    await SecureStore.deleteItemAsync(chunkCountKey(key));

    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  } catch (err) {
    console.warn("[SecureStore] secureDeleteChunked failed — keychain entry may linger:", err);
  }
}

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    if (Platform.OS === "web") {
      return AsyncStorage.getItem(key);
    }
    // Returning no session while closed prevents GoTrue's module-time
    // initialization from accessing SecureStore or refreshing stale tokens.
    if (!nativeStorageAccessGate.canAccess()) {
      return Promise.resolve(null);
    }
    return secureGetChunked(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === "web") {
      return AsyncStorage.setItem(key, value);
    }
    return secureSetChunked(key, value);
  },
  removeItem: (key: string) => {
    if (Platform.OS === "web") {
      return AsyncStorage.removeItem(key);
    }
    return secureDeleteChunked(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    // AuthProvider opens native storage and validates sessions explicitly.
    // Browser visibility handling remains the SDK default.
    autoRefreshToken: Platform.OS === "web",
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
  global: {
    fetch: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
  },
});

export const supabaseConfigurationError = runtimeConfig.errorMessage;
