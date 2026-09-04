import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

process.env.EXPO_PUBLIC_SUPABASE_URL = "https://unit-project.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "unit-anon-key";
process.env.SUPABASE_DB_URL =
  "postgresql://postgres:password@db.unit-project.supabase.co:5432/postgres";

const { createDeleteUserHandler } = await import("./users");

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function response() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("DELETE /users/:id", () => {
  it("rejects an authenticated caller attempting to erase another account", async () => {
    const transaction = vi.fn();
    const handler = createDeleteUserHandler({
      database: { transaction } as never,
      log: silentLogger,
    });
    const res = response();

    await handler(
      { params: { id: otherUserId }, user: { id: userId } } as unknown as Request,
      res as unknown as Response,
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "USER_DELETE_IDENTITY_MISMATCH",
    }));
  });

  it("uses one transaction for every cleanup statement and the auth identity", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) => callback({ execute }));
    const handler = createDeleteUserHandler({
      database: { transaction } as never,
      log: silentLogger,
    });
    const res = response();

    await handler(
      { params: { id: userId }, user: { id: userId } } as unknown as Request,
      res as unknown as Response,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalled();
    // Drizzle stores literal SQL fragments in the first query chunk.
    expect(execute.mock.calls.at(-1)?.[0].queryChunks[0].value.join("")).toContain("auth.users");
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it("removes saved-sentence provenance and reserved scheduled sends before deleting parents", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) => callback({ execute }));
    const handler = createDeleteUserHandler({
      database: { transaction } as never,
      log: silentLogger,
    });

    await handler(
      { params: { id: userId }, user: { id: userId } } as unknown as Request,
      response() as unknown as Response,
    );

    const statements = execute.mock.calls.map(([statement]) =>
      statement.queryChunks
        .flatMap((chunk: { value?: string[] }) => chunk.value ?? [])
        .join(""),
    );
    const detachProvenance = statements.findIndex((query) =>
      query.includes("UPDATE thoughts SET source_stored_sentence_id = NULL"),
    );
    const deleteSentences = statements.findIndex((query) =>
      query.includes("DELETE FROM stored_sentences"),
    );
    const deleteScheduledSends = statements.find((query) =>
      query.includes("DELETE FROM space_scheduled_sends WHERE"),
    );

    expect(detachProvenance).toBeGreaterThanOrEqual(0);
    expect(deleteSentences).toBeGreaterThan(detachProvenance);
    expect(deleteScheduledSends).toContain("reservation_author_id");
  });

  it("preserves other users' thoughts and letters while detaching deleted article provenance", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async (callback) => callback({ execute }));
    const handler = createDeleteUserHandler({
      database: { transaction } as never,
      log: silentLogger,
    });

    await handler(
      { params: { id: userId }, user: { id: userId } } as unknown as Request,
      response() as unknown as Response,
    );

    const statements = execute.mock.calls.map(([statement]) =>
      statement.queryChunks
        .flatMap((chunk: { value?: string[] }) => chunk.value ?? [])
        .join(""),
    );
    expect(statements).toContain("DELETE FROM thoughts WHERE author_id = ");
    expect(statements).toContain(
      "UPDATE thoughts SET source_article_id = NULL WHERE author_id <>  AND source_article_id IN (SELECT id FROM articles WHERE author_id = )",
    );
    expect(statements).toContain(
      "UPDATE space_letters SET source_article_id = NULL WHERE author_id <>  AND source_article_id IN (SELECT id FROM articles WHERE author_id = )",
    );
    expect(statements).not.toContain(
      "DELETE FROM thoughts WHERE author_id =  OR source_article_id",
    );
  });

  it("returns an explicit retry-safe error when auth deletion cannot run", async () => {
    const transaction = vi.fn(async () => {
      throw { code: "42501" };
    });
    const handler = createDeleteUserHandler({
      database: { transaction } as never,
      log: silentLogger,
    });
    const res = response();

    await handler(
      { params: { id: userId }, user: { id: userId } } as unknown as Request,
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "USER_DELETE_AUTH_UNAVAILABLE",
    }));
  });
});