import { describe, expect, it } from "vitest";
import {
  resolveDetailEntity,
  type DetailQuerySnapshot,
} from "../detailEntityResolution";

type Thought = { id: string; content: string };
type Article = { id: string; status: string; content: string };

const loading = <T>(): DetailQuerySnapshot<T> => ({
  isError: false,
  isLoading: true,
});

const missing = <T>(): DetailQuerySnapshot<T> => ({
  error: { status: 404 },
  isError: true,
  isLoading: false,
});

const failed = <T>(): DetailQuerySnapshot<T> => ({
  error: { status: 500 },
  isError: true,
  isLoading: false,
});

const success = <T>(data: T): DetailQuerySnapshot<T> => ({
  data,
  isError: false,
  isLoading: false,
});

describe("detail entity resolution", () => {
  it("keeps a successfully loaded thought open when the parallel article request returns 404", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: success<Thought>({ id: "thought-1", content: "저장된 단상" }),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "success",
      entity: "thought",
      thought: { content: "저장된 단상" },
    });
  });

  it("waits for the thought result even when the article response arrives first", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: loading<Thought>(),
      article: success<Article>({ id: "article-1", status: "DIVIDING", content: "분할 글" }),
    })).toEqual({ kind: "loading", entity: "thought" });
  });

  it("opens a DIVIDING article after the thought lookup confirms its expected 404", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: success<Article>({ id: "article-1", status: "DIVIDING", content: "분할 글" }),
    })).toMatchObject({
      kind: "success",
      entity: "article",
      article: { id: "article-1" },
    });
  });

  it("recovers a direct on-01a article route when mode=dividing was omitted", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: success<Article>({ id: "article-1", status: "DIVIDING", content: "서버 본문" }),
    })).toEqual({
      kind: "success",
      entity: "article",
      article: { id: "article-1", status: "DIVIDING", content: "서버 본문" },
    });
  });

  it("uses article-only loading and failure states for a requested dividing route", () => {
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: loading<Thought>(),
      article: loading<Article>(),
    })).toEqual({ kind: "loading", entity: "article" });

    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: success<Thought>({ id: "thought-1", content: "ignored" }),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-found",
      retryEntity: "article",
    });
  });

  it("assigns failures and retry paths to the entity that actually failed", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: failed<Thought>(),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "thought",
      reason: "request-failed",
      retryEntity: "thought",
    });

    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: failed<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "request-failed",
      retryEntity: "article",
    });
  });

  it("does not allow a non-DIVIDING article to enter the dividing editor", () => {
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: missing<Thought>(),
      article: success<Article>({ id: "closing-1", status: "CLOSING", content: "마감 글" }),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-dividing",
      retryEntity: "article",
    });
  });
});