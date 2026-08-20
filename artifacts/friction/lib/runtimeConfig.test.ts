import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl, readRuntimeConfig } from "./runtimeConfig";

describe("runtime config", () => {
  it("normalizes a deployment host to an absolute API base URL", () => {
    expect(normalizeApiBaseUrl("friction-1.replit.app")).toBe(
      "https://friction-1.replit.app",
    );
    expect(normalizeApiBaseUrl("https://friction-1.replit.app/")).toBe(
      "https://friction-1.replit.app",
    );
  });

  it("rejects relative, placeholder, and path-bearing API values", () => {
    expect(normalizeApiBaseUrl("/api")).toBeNull();
    expect(normalizeApiBaseUrl("https://placeholder.supabase.co")).toBeNull();
    expect(normalizeApiBaseUrl("https://friction-1.replit.app/api")).toBeNull();
  });

  it("reports missing release values without exposing their contents", () => {
    const config = readRuntimeConfig({});

    expect(config.errorMessage).toContain("EXPO_PUBLIC_SUPABASE_URL");
    expect(config.errorMessage).toContain("EXPO_PUBLIC_DOMAIN");
    expect(config.errorMessage).not.toContain("anon");
    expect(config.supabaseUrl).toBeNull();
    expect(config.supabaseAnonKey).toBeNull();
  });

  it("accepts a complete release configuration", () => {
    const config = readRuntimeConfig({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-anon-key",
      apiDomain: "friction-1.replit.app",
    });

    expect(config.errorMessage).toBeNull();
    expect(config.apiBaseUrl).toBe("https://friction-1.replit.app");
  });
});