import { describe, expect, it } from "vitest";
import { inspectSupabaseEnvironment } from "./supabaseEnvironment";

describe("Supabase environment inspection", () => {
  it("accepts matching direct database and auth targets", () => {
    expect(
      inspectSupabaseEnvironment({
        authUrl: "https://project-one.supabase.co",
        databaseUrl: "postgresql://postgres:password@db.project-one.supabase.co:5432/postgres",
      }),
    ).toEqual({ status: "ready" });
  });

  it("accepts a matching pooler role without exposing the target", () => {
    expect(
      inspectSupabaseEnvironment({
        authUrl: "https://project-one.supabase.co",
        databaseUrl:
          "postgresql://postgres.project-one:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      }),
    ).toEqual({ status: "ready" });
  });

  it("rejects missing, unverified, and mismatched targets with stable codes", () => {
    expect(inspectSupabaseEnvironment({ databaseUrl: "postgresql://x" })).toEqual({
      status: "AUTH_TARGET_INVALID",
    });
    expect(
      inspectSupabaseEnvironment({
        authUrl: "https://project-one.supabase.co",
        databaseUrl: "postgresql://postgres:password@database.example.test/postgres",
      }),
    ).toEqual({ status: "DATABASE_TARGET_UNVERIFIABLE" });
    expect(
      inspectSupabaseEnvironment({
        authUrl: "https://project-one.supabase.co",
        databaseUrl: "postgresql://postgres:password@db.project-two.supabase.co/postgres",
      }),
    ).toEqual({ status: "SUPABASE_PROJECT_MISMATCH" });
  });

  it("never throws when a database credential is malformed", () => {
    expect(() =>
      inspectSupabaseEnvironment({
        authUrl: "https://project-one.supabase.co",
        databaseUrl:
          "postgresql://postgres%ZZ:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      }),
    ).not.toThrow();
    expect(
      inspectSupabaseEnvironment({
        authUrl: "https://project-one.supabase.co",
        databaseUrl:
          "postgresql://postgres%ZZ:password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      }),
    ).toEqual({ status: "DATABASE_TARGET_UNVERIFIABLE" });
  });
});