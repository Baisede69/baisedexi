// Playwright 配置：仅用 Chromium，针对本地静态服务做游戏功能验证
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8123",
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 5000,
  },
});
