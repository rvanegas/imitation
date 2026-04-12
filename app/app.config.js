const fs = require('fs');
const path = require('path');
const os = require('os');

let serverUrl = 'ws://localhost:8080';
try {
  const TOML = require('../node_modules/@iarna/toml');
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const raw = TOML.parse(fs.readFileSync(path.join(configDir, 'imitation', 'config.toml'), 'utf8'));
  if (raw.websocket?.url) serverUrl = raw.websocket.url;
} catch {}

module.exports = {
  expo: {
    name: "app",
    slug: "app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: { supportsTablet: true },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: { favicon: "./assets/favicon.png" },
    plugins: ["expo-secure-store"],
    extra: { serverUrl },
  },
};
