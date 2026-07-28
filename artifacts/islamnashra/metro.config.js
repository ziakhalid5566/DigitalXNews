const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// pnpm workspace root — two levels up from artifacts/islamnashra
const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

config.resolver = config.resolver || {};

// pnpm fix: Metro only looks in the package's own node_modules by default.
// In a pnpm workspace, transitive deps like babel-preset-expo live in the
// workspace root's node_modules. Add it here so Metro can find them.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Also watch the workspace root so cross-package imports resolve correctly.
config.watchFolders = [workspaceRoot];

// Block supabase-phoenix temp dirs that don't physically exist
// (Metro crashes trying to watch them on Replit)
config.resolver.blockList = [
  /node_modules\/@supabase\/phoenix_tmp.*/,
];

module.exports = config;
