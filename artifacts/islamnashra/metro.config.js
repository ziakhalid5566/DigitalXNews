const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Block supabase-phoenix temp dirs that don't physically exist
// (Metro crashes trying to watch them on Replit)
config.resolver = config.resolver || {};
config.resolver.blockList = [
  /node_modules\/@supabase\/phoenix_tmp.*/,
];

module.exports = config;
