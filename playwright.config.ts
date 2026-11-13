import { defineConfig, devices } from "@playwright/test";

const liveBaseUrl = process.env.CANOPY_BASE_URL;
const localPort = Number.parseInt(process.env.CANOPY_TEST_PORT || "4173", 10);
const localBaseUrl = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: liveBaseUrl || localBaseUrl, trace: "retain-on-failure" },
  webServer: liveBaseUrl ? undefined : {
    command: `PORT=${localPort} node server.mjs`,
    url: localBaseUrl,
    reuseExistingServer: false,
  },
  projects: [
    { name: "video-chromium", testMatch: "video.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "video-webkit", testMatch: "video.spec.ts", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", testMatch: ["client.spec.ts", "settings-sync.spec.ts", "guest.spec.ts", "signer-startup.spec.ts", "relay-publish.spec.ts", "blossom-list.spec.ts"], use: { ...devices["iPhone 13"] } },
    { name: "desktop-webkit", testMatch: "desktop-refresh.spec.ts", use: { ...devices["Desktop Safari"] } },
  ],
});

