const assert = require("assert");
const http = require("http");
const {
  DEFAULT_METRO_PORT,
  getBundleConfigurationPresence,
  selectOwnedMetroPort,
} = require("./build.js");

async function main() {
  const staleMetro = http.createServer((request, response) => {
    if (request.url === "/status") {
      response.writeHead(200);
      response.end("packager-status:running");
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve, reject) => {
    staleMetro.once("error", reject);
    staleMetro.listen(DEFAULT_METRO_PORT, "127.0.0.1", resolve);
  });

  try {
    const selectedPort = await selectOwnedMetroPort();
    assert.notStrictEqual(
      selectedPort,
      DEFAULT_METRO_PORT,
      "a healthy stale Metro must never be reused",
    );
    assert(selectedPort > DEFAULT_METRO_PORT);
  } finally {
    await new Promise((resolve) => staleMetro.close(resolve));
  }

  const selectedWithoutConflict = await selectOwnedMetroPort();
  assert.strictEqual(selectedWithoutConflict, DEFAULT_METRO_PORT);

  const expected = {
    EXPO_PUBLIC_SUPABASE_URL: "https://release-test.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "release-test-anon-key",
    EXPO_PUBLIC_DOMAIN: "release-test.example",
  };
  assert.deepStrictEqual(
    getBundleConfigurationPresence(Object.values(expected).join("|"), expected),
    {
      EXPO_PUBLIC_SUPABASE_URL: true,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: true,
      EXPO_PUBLIC_DOMAIN: true,
    },
  );
  assert.deepStrictEqual(
    getBundleConfigurationPresence(
      `${expected.EXPO_PUBLIC_SUPABASE_URL}|${expected.EXPO_PUBLIC_DOMAIN}`,
      expected,
    ),
    {
      EXPO_PUBLIC_SUPABASE_URL: true,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: false,
      EXPO_PUBLIC_DOMAIN: true,
    },
  );

  console.log(
    "Build Metro isolation rejects a healthy stale Metro, owns a free port, " +
      "and reports configuration presence without exposing values.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});