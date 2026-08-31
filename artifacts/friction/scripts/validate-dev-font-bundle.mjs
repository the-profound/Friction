#!/usr/bin/env node
/**
 * Validate the actual iOS and Android development bundles served by Metro.
 *
 * This intentionally checks the generated bundle, not just metro.config.js:
 * a resolver typo can leave the configuration looking correct while the
 * native module graph omits one of the font assets.
 */
import { readFile } from "node:fs/promises";
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

function validateBundle(bundle, platform) {
  const missing = [];
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
  }

  if (missing.length > 0) {
    throw new Error(
      `${platform} Dev bundle is missing ${missing.join(", ")}. ` +
        `Expected font contract ${contractVersion}; server=${baseUrl}.`,
    );
  }
}

async function fetchBundle(platform) {
  const response = await fetch(bundleUrl(platform), {
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${platform} Dev bundle: HTTP ${response.status} from ${baseUrl}.`,
    );
  }
  return response.text();
}

const status = await fetch(`${baseUrl}/status`, {
  signal: AbortSignal.timeout(5000),
}).catch(() => null);
if (!status?.ok) {
  throw new Error(
    `Metro is not running at ${baseUrl}. Start the Friction preview or tunnel server first.`,
  );
}
const servedProjectRoot = status.headers.get("x-react-native-project-root");
if (
  servedProjectRoot !== projectRoot ||
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
  validateBundle(bundle, platform);
  console.log(
    `[dev-fonts] ${platform}: validated ${fonts.length} WOFF2 asset modules ` +
      `and contract ${contractVersion} from ${baseUrl} ` +
      `(serverId=${serverMarker.serverId})`,
  );
}
