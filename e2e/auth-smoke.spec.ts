import { expect, test } from "@playwright/test";

test("redirects unauthenticated root access to login page", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
});

test("redirects unauthenticated protected route to login", async ({ page }) => {
	await page.goto("/conversations");
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
});

test("shows error on invalid login credentials", async ({ page }) => {
	await page.goto("/login");
	await page.getByRole("textbox", { name: "用户名" }).first().fill("no_such_user");
	await page.getByLabel("密码").first().fill("wrong-password");
	await page.getByRole("button", { name: "进入" }).click();

	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByText("用户名或密码错误。")).toBeVisible();
});
