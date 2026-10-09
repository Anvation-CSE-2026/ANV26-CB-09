import { test, expect } from "@playwright/test";

test("the generated API reference renders and filters without internet assets", async ({
  page,
}) => {
  const errors: string[] = [];
  const remoteRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      remoteRequests.push(request.url());
  });
  const response = await page.goto("http://127.0.0.1:8000/docs");
  expect(response?.headers()["content-security-policy"]).toContain(
    "script-src 'self'",
  );
  await expect(page.getByRole("status")).toContainText("API version 3.0.0");
  await page
    .getByLabel("Find an endpoint", { exact: true })
    .fill("/api/org/account/password");
  const visible = page.locator("#endpoints details:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible.locator("summary")).toContainText(
    "POST  /api/org/account/password",
  );
  await visible.locator("summary").click();
  await expect(visible.locator("pre")).toContainText("requestBody");
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});
