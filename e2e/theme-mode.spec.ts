import { expect, test } from "@playwright/test";

test("bootstraps dark theme from localStorage", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("theme", "dark");
	});

	await page.goto("/login");
	await expect(page.locator("html")).toHaveClass(/dark/);
});

test("bootstraps light theme from localStorage", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("theme", "light");
	});

	await page.goto("/login");
	await expect(page.locator("html")).not.toHaveClass(/dark/);
});
