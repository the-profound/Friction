import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { pipeStorageResponse } from "./storage";

function createRequest() {
  return {
    id: "req_abcdefghijklmnopqrst",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function createResponse() {
  const stream = new PassThrough() as PassThrough & {
    status: (status: number) => typeof stream;
    setHeader: ReturnType<typeof vi.fn>;
    statusCode: number;
  };
  stream.statusCode = 200;
  stream.status = (status: number) => {
    stream.statusCode = status;
    return stream;
  };
  stream.setHeader = vi.fn();
  return stream;
}

describe("storage download stream telemetry", () => {
  it("records success only after the response stream finishes", async () => {
    const req = createRequest();
    const res = createResponse();
    const finished = new Promise<void>((resolve) => res.once("finish", resolve));

    pipeStorageResponse(
      req as never,
      res as never,
      new Response("stored bytes", { status: 200 }),
      performance.now(),
    );
    expect(req.log.info).not.toHaveBeenCalled();
    res.resume();
    await finished;

    expect(req.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "storage.download",
        outcome: "success",
        correlationId: req.id,
      }),
      expect.any(String),
    );
  });

  it("records a stream failure once without serializing the thrown message", async () => {
    const req = createRequest();
    const res = createResponse();
    const closed = new Promise<void>((resolve) => res.once("close", resolve));
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("private storage provider response"));
      },
    });

    pipeStorageResponse(
      req as never,
      res as never,
      new Response(body, { status: 200 }),
      performance.now(),
    );
    res.resume();
    await closed;

    const serialized = JSON.stringify(req.log.error.mock.calls);
    expect(serialized).toContain("stream_failed");
    expect(serialized).not.toContain("private storage provider response");
    expect(req.log.error).toHaveBeenCalledTimes(1);
  });
});