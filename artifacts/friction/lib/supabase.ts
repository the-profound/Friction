import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// `createClient` throws synchronously ("supabaseUrl is required.") if either
// value is empty. That would happen at module-import time — before any
// try/catch in app code can catch it — and crash the app on launch. Fall
// back to an inert-but-valid placeholder so the client can always be
// constructed; every real request will then fail with a normal network/auth
// error instead of an unrecoverable startup crash.
const rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const rawSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!rawSupabaseUrl || !rawSupabaseAnonKey) {
  console.warn(
    "[supabase] EXPO_PUBLIC_SUPABASE_URL and/or EXPO_PUBLIC_SUPABASE_ANON_KEY are missing from this build; falling back to a placeholder client so startup does not crash."
  );
}

const supabaseUrl = rawSupabaseUrl || "https://placeholder.supabase.co";
const supabaseAnonKey = rawSupabaseAnonKey || "placeholder-anon-key";

const CHUNK_SIZE = 1800;

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
    // On React Native, the SDK refreshes an expired token while it initializes
    // and logs a non-retryable refresh error before app code can handle it.
    // AuthProvider restores and validates the session explicitly, then starts
    // this refresher only while the app is active. Browser visibility handling
    // remains the SDK default.
    autoRefreshToken: Platform.OS === "web",
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
  global: {
    fetch: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
  },
});
