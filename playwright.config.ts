import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "list",
	use: {
		baseURL,
		trace: "retain-on-failure",
	},
	webServer: {
		command: `npm run preview -- --host 127.0.0.1 --port ${PORT}`,
		url: `${baseURL}/login`,
		reuseExistingServer: !process.env.CI,
		timeout: 240000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], channel: "chrome" },
		},
	],
});
