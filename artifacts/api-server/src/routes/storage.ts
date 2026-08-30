import express, { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  UploadInlineImageResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const inlineImageBucket = process.env.SUPABASE_INLINE_IMAGE_BUCKET ?? "inline-images";

function createUserStorageClient(authorization: string) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase Storage is not configured");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;

function isJpegBuffer(value: unknown): value is Buffer {
  return Buffer.isBuffer(value)
    && value.length >= 4
    && value[0] === 0xff
    && value[1] === 0xd8
    && value[2] === 0xff
    && value[value.length - 2] === 0xff
    && value[value.length - 1] === 0xd9;
}

router.post(
  "/storage/inline-images",
  requireAuth,
  express.raw({ type: "image/jpeg", limit: MAX_INLINE_IMAGE_BYTES }),
  async (req: Request, res: Response) => {
  const authorization = req.header("authorization");
  if (!authorization || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isJpegBuffer(req.body) || req.body.length > MAX_INLINE_IMAGE_BYTES) {
    res.status(400).json({ error: "A valid JPEG image up to 10MB is required" });
    return;
  }

  try {
    // The app always re-encodes selected images to JPEG. Inspect the binary
    // before upload so the API never trusts picker-supplied metadata.
    const objectPath = `originals/${req.user.id}/${randomUUID()}.jpg`;
    const storage = createUserStorageClient(authorization).storage.from(inlineImageBucket);
    const { error: uploadError } = await storage.upload(objectPath, req.body, {
      upsert: false,
      contentType: "image/jpeg",
    });
    if (uploadError) {
      req.log.error({ err: uploadError }, "Unable to upload verified inline image");
      res.status(503).json({ error: "Unable to upload image" });
      return;
    }

    const { data: publicUrl } = storage.getPublicUrl(objectPath);
    res.json(UploadInlineImageResponse.parse({
      imageUrl: publicUrl.publicUrl,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Error uploading verified Supabase inline image");
    res.status(500).json({ error: "Failed to upload image" });
  }
});

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(RequestUploadUrlResponse.parse({
      uploadURL,
      objectPath,
      metadata: { name, size, contentType },
    }));
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    if (wildcardPath.startsWith("cover-staging/")) {
      throw new ObjectNotFoundError();
    }
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
