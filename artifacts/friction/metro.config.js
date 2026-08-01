const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
// pnpm monorepo root (artifacts/friction → ../../)
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch all workspace packages so Metro can resolve symlinked libs
config.watchFolders = [workspaceRoot];

// Look up node_modules from both the app package and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Force a single React / React-Native instance across all workspace packages.
// Without this, Metro can resolve `react` relative to each symlinked lib dir
// (e.g. lib/api-client-react) and load a second copy, causing "invalid hook
// call" and "cannot read property 'useContext' of null".
// Force single instances of React and packages that use React context.
// Without this, pnpm's isolated node_modules can produce separate copies
// for workspace libs (e.g. lib/api-client-react), causing "invalid hook call"
// and "cannot read property 'useContext' of null" at runtime.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native/": path.resolve(projectRoot, "node_modules/react-native"),
  "@tanstack/react-query": path.resolve(
    projectRoot,
    "node_modules/@tanstack/react-query"
  ),
};

module.exports = config;
