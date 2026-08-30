import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getCoverImageUploadTarget(articleId: string): Promise<{
    uploadURL: string;
    objectPath: string;
  }> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/cover-staging/${articleId}/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const uploadURL = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
    return {
      uploadURL,
      objectPath: `/objects/cover-staging/${articleId}/${objectId}`,
    };
  }

  async verifyAndPublishCoverImage(
    articleId: string,
    objectPath: string,
    maxBytes: number,
  ): Promise<string> {
    const expectedPrefix = `/objects/cover-staging/${articleId}/`;
    if (!objectPath.startsWith(expectedPrefix)) {
      throw new InvalidCoverImageError("Invalid staged cover image path");
    }

    const stagedFile = await this.getObjectEntityFile(objectPath);
    const [metadata] = await stagedFile.getMetadata();
    const generation = metadata.generation;
    if (generation === undefined || generation === null) {
      throw new InvalidCoverImageError("Cover upload generation is unavailable");
    }
    const size = Number(metadata.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
      throw new InvalidCoverImageError("Cover image must not exceed 10MB");
    }
    if (
      typeof metadata.contentType !== "string" ||
      !metadata.contentType.startsWith("image/")
    ) {
      throw new InvalidCoverImageError("Cover upload must use an image MIME type");
    }

    // Pin the read to the exact generation whose metadata was checked. The
    // short-lived signed PUT can still replace the unversioned staging key.
    const versionedStagedFile = stagedFile.bucket.file(stagedFile.name, {
      generation,
    });
    const [bytes] = await versionedStagedFile.download();
    const detected = inspectCoverImageBytes(bytes, maxBytes);

    const privateObjectDir = this.getPrivateObjectDir();
    const destinationPath =
      `${privateObjectDir}/cover-images/${articleId}/${randomUUID()}.${detected.extension}`;
    const { bucketName, objectName } = parseObjectPath(destinationPath);
    const destination = objectStorageClient.bucket(bucketName).file(objectName);
    // Publish the exact bytes we inspected to a new immutable-by-name object.
    // The staging PUT URL remains valid briefly, so moving the mutable source
    // would allow it to be overwritten between verification and publication.
    await destination.save(bytes, {
      resumable: false,
      contentType: detected.contentType,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    return `/objects/cover-images/${articleId}/${destination.name.split("/").pop()}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }
}

export class InvalidCoverImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCoverImageError";
    Object.setPrototypeOf(this, InvalidCoverImageError.prototype);
  }
}

export function detectCoverImageType(
  bytes: Buffer,
): { contentType: string; extension: string } | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  const signature = bytes.subarray(0, 12).toString("ascii");
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return { contentType: "image/heic", extension: "heic" };
    }
    if (["avif", "avis"].includes(brand)) {
      return { contentType: "image/avif", extension: "avif" };
    }
  }
  return null;
}

export function inspectCoverImageBytes(
  bytes: Buffer,
  maxBytes: number,
): { contentType: string; extension: string } {
  if (bytes.length <= 0 || bytes.length > maxBytes) {
    throw new InvalidCoverImageError("Cover image must not exceed 10MB");
  }
  const detected = detectCoverImageType(bytes);
  if (!detected) {
    throw new InvalidCoverImageError("Unsupported or invalid cover image");
  }
  return detected;
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return { bucketName, objectName };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const data = await response.json() as { signed_url: string };
  return data.signed_url;
}
