#!/usr/bin/env node
/**
 * Validate the actual iOS and Android development bundles served by Metro.
 *
 * This intentionally checks the generated bundle, not just metro.config.js:
 * a resolver typo can leave the configuration looking correct while the
 * native module graph omits one of the font assets.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(projectRoot, "../..");
const entryPath = path.relative(
  workspaceRoot,
  path.join(projectRoot, "node_modules", "expo-router", "entry"),
);
const portArgIndex = process.argv.indexOf("--port");
const port =
  (portArgIndex === -1 ? undefined : process.argv[portArgIndex + 1]) ||
  process.env.PORT ||
  "21672";
const baseUrl = `http://localhost:${port}`;
const originArgIndexes = process.argv
  .map((value, index) => (value === "--origin" ? index : -1))
  .filter((index) => index !== -1);
const publicOrigins = originArgIndexes.map((index) => {
  const value = process.argv[index + 1];
  if (!value) throw new Error("--origin requires an absolute http(s) URL.");
  const origin = new URL(value);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error(`Unsupported validation origin: ${value}`);
  }
  return origin.origin;
});
const assetOrigins = [...new Set([baseUrl, ...publicOrigins])];
const markerPath = path.join(
  projectRoot,
  ".expo",
  `friction-metro-${port}.json`,
);
const serverMarker = JSON.parse(
  await readFile(markerPath, "utf8").catch(() => {
    throw new Error(
      `No Friction Metro marker was found for port ${port}. ` +
        "Restart this server through the shared preview or tunnel entry point.",
    );
  }),
);
const fontContractSource = await readFile(
  path.join(projectRoot, "components/shared/bodyTypographyFonts.ts"),
  "utf8",
);
const contractVersion =
  fontContractSource.match(
    /BODY_FONT_CONFIG_VERSION\s*=\s*["']([^"']+)["']/,
  )?.[1] ?? "unknown";

const fonts = [
  {
    path: "assets/fonts/Eulyoo1945-Regular.woff2",
    name: "Eulyoo1945-Regular",
  },
  {
    path: "assets/fonts/Eulyoo1945-SemiBold.woff2",
    name: "Eulyoo1945-SemiBold",
  },
  {
    path: "assets/fonts/NotoSerifKR-400Regular-korean.woff2",
    name: "NotoSerifKR-400Regular-korean",
  },
  {
    path: "assets/fonts/NotoSerifKR-600SemiBold-korean.woff2",
    name: "NotoSerifKR-600SemiBold-korean",
  },
];

function bundleUrl(platform) {
  const url = new URL(`/${entryPath}.bundle`, `${baseUrl}/`);
  url.search = new URLSearchParams({
    platform,
    dev: "true",
    hot: "false",
    lazy: "true",
    "transform.engine": "hermes",
    "transform.bytecode": "0",
    "transform.routerRoot": "app",
    "transform.reactCompiler": "true",
    unstable_transformProfile: "hermes-stable",
  }).toString();
  return url;
}

function findAssetRecord(bundle, font) {
  const marker = `],"${font.path}")`;
  const end = bundle.indexOf(marker);
  if (end === -1) return null;
  const start = bundle.lastIndexOf("__d(", end);
  return start === -1 ? null : bundle.slice(start, end + marker.length);
}

function parseAssetMetadata(record, font, platform) {
  const readString = (key) =>
    record.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1];
  const metadata = {
    httpServerLocation: readString("httpServerLocation"),
    hash: readString("hash"),
    name: readString("name"),
    type: readString("type"),
  };
  if (Object.values(metadata).some((value) => !value)) {
    throw new Error(
      `${platform} ${font.path} has incomplete downloadable asset metadata.`,
    );
  }
  return metadata;
}

function validateBundle(bundle, platform) {
  const missing = [];
  const metadataByFont = new Map();
  if (!bundle.includes(contractVersion)) {
    missing.push(`body font contract ${contractVersion}`);
  }
  if (!bundle.includes(serverMarker.serverId)) {
    missing.push(`Dev server identity ${serverMarker.serverId}`);
  }

  for (const font of fonts) {
    const record = findAssetRecord(bundle, font);
    if (!record) {
      missing.push(`${font.path} module`);
      continue;
    }
    for (const metadata of [
      `"__packager_asset": true`,
      `"httpServerLocation"`,
      `"hash"`,
      `"name": "${font.name}"`,
      `"type": "woff2"`,
      `"fileHashes"`,
      "registerAsset",
    ]) {
      if (!record.includes(metadata)) {
        missing.push(`${font.path} metadata ${metadata}`);
      }
    }
    metadataByFont.set(font.path, parseAssetMetadata(record, font, platform));
  }

  if (missing.length > 0) {
    throw new Error(
      `${platform} Dev bundle is missing ${missing.join(", ")}. ` +
        `Expected font contract ${contractVersion}; server=${baseUrl}.`,
    );
  }
  return metadataByFont;
}

async function fetchWithRetry(url, timeoutMs, label) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(
    `${label} failed at ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function fetchBundle(platform) {
  const response = await fetchWithRetry(
    bundleUrl(platform),
    300_000,
    `${platform} Dev bundle download`,
  );
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${platform} Dev bundle: HTTP ${response.status} from ${baseUrl}.`,
    );
  }
  return response.text();
}

function assetUrl(origin, metadata, platform) {
  const url = new URL(
    `${metadata.httpServerLocation}/${encodeURIComponent(metadata.name)}.${encodeURIComponent(metadata.type)}`,
    `${origin}/`,
  );
  url.searchParams.set("platform", platform);
  url.searchParams.set("hash", metadata.hash);
  return url;
}

async function validateAssetDownload(origin, platform, font, metadata) {
  const url = assetUrl(origin, metadata, platform);
  const response = await fetchWithRetry(
    url,
    60_000,
    `${platform} ${font.path} asset download from ${origin}`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = await readFile(path.join(projectRoot, font.path));
  const signature = bytes.subarray(0, 4).toString("ascii");
  const metroHash = createHash("md5").update(bytes).digest("hex");
  if (
    signature !== "wOF2" ||
    !bytes.equals(expected) ||
    metroHash !== metadata.hash
  ) {
    throw new Error(
      `${platform} ${font.path} returned invalid bytes from ${url}: ` +
        `contentType=${response.headers.get("content-type") ?? "unknown"}, ` +
        `signature=${JSON.stringify(signature)}, bytes=${bytes.length}, ` +
        `metroHash=${metroHash}, expectedHash=${metadata.hash}.`,
    );
  }
  console.log(
    `[dev-fonts] ${platform}: downloaded ${font.path} from ${origin} ` +
      `(${bytes.length} bytes, ${response.headers.get("content-type") ?? "unknown"})`,
  );
}

for (const origin of assetOrigins) {
  const status = await fetchWithRetry(
    `${origin}/status`,
    5000,
    `Metro status check for ${origin}`,
  );
  const servedProjectRoot = status.headers.get("x-react-native-project-root");
  if (servedProjectRoot !== projectRoot) {
    throw new Error(
      `Metro public route mismatch at ${origin}. ` +
        `Expected root=${projectRoot}; received root=${servedProjectRoot ?? "unknown"}.`,
    );
  }
}

if (
  serverMarker.projectRoot !== projectRoot ||
  String(serverMarker.port) !== String(port) ||
  serverMarker.fontContractVersion !== contractVersion
) {
  throw new Error(
    `Metro identity mismatch at ${baseUrl}. ` +
      `Expected root=${projectRoot}, contract=${contractVersion}, ` +
      `serverId=${serverMarker.serverId}. Restart the matching Friction Dev server.`,
  );
}

for (const platform of ["ios", "android"]) {
  const bundle = await fetchBundle(platform);
  const metadataByFont = validateBundle(bundle, platform);
  for (const origin of assetOrigins) {
    for (const font of fonts) {
      await validateAssetDownload(
        origin,
        platform,
        font,
        metadataByFont.get(font.path),
      );
    }
  }
  console.log(
    `[dev-fonts] ${platform}: validated ${fonts.length} WOFF2 asset modules ` +
      `and downloads from ${assetOrigins.join(", ")}; contract ${contractVersion} from ${baseUrl} ` +
      `(serverId=${serverMarker.serverId})`,
  );
}
