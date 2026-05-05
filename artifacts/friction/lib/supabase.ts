import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

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

async function secureGetChunked(key: string): Promise<string | null> {
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
}

async function secureSetChunked(key: string, value: string): Promise<void> {
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
}

async function secureDeleteChunked(key: string): Promise<void> {
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
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
  global: {
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  },
});
