const assert = require("assert");
const path = require("path");

const metroConfig = require("../metro.config.js");

const projectRoot = path.resolve(__dirname, "..");
const appOrigin = path.join(projectRoot, "package.json");
const workspaceLibraryOrigin = path.resolve(
  projectRoot,
  "../../lib/api-client-react/src/generated/api.ts",
);

function resolveFrom(originModulePath, moduleName) {
  return metroConfig.resolver.resolveRequest(
    {
      originModulePath,
      resolveRequest(context, requestedModuleName) {
        return {
          type: "sourceFile",
          filePath: `${context.originModulePath}::${requestedModuleName}`,
        };
      },
    },
    moduleName,
    "ios",
  );
}

for (const moduleName of [
  "react",
  "react/jsx-runtime",
  "react-native",
  "react-native/Libraries/Utilities/Platform",
  "@tanstack/react-query",
]) {
  assert.strictEqual(
    resolveFrom(workspaceLibraryOrigin, moduleName).filePath,
    `${appOrigin}::${moduleName}`,
    `${moduleName} must resolve from the Friction app`,
  );
}

assert.strictEqual(
  resolveFrom(workspaceLibraryOrigin, "zod").filePath,
  `${workspaceLibraryOrigin}::zod`,
  "non-singleton dependencies must retain normal Metro resolution",
);

console.log(
  "Metro resolves React, React Native, and React Query from the Friction app.",
);