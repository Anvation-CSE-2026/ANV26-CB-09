import { test, expect } from "@playwright/test";

test("collector retries preserve the exact original observation after an uncertain delivery", async ({
  page,
}) => {
  const observations: unknown[] = [];
  let attempts = 0;
  await page.route("**/api/hosted/complete", async (route) => {
    observations.push(route.request().postDataJSON());
    attempts++;
    await route.fulfill({
      status: attempts <= 3 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        attempts <= 3
          ? { detail: "temporarily unavailable" }
          : { accepted: 0, duplicate: true },
      ),
    });
  });
  await page.goto("/");
  await page.addScriptTag({ url: "/identity-lens.js" });
  const result = await page.evaluate(async () => {
    const sdk = (
      window as unknown as {
        IdentityLens: {
          attach: (o: Record<string, unknown>) => {
            complete: () => Promise<unknown>;
          };
        };
      }
    ).IdentityLens;
    const form = document.createElement("form");
    const input = document.createElement("input");
    form.append(input);
    document.body.append(form);
    const collector = sdk.attach({
      form,
      ticket: "a-private-test-ticket-only",
      endpoint: "/api/hosted/complete",
      noticeAcknowledged: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    let failed = false;
    try {
      await collector.complete();
    } catch {
      failed = true;
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const second = await collector.complete();
    form.remove();
    return { failed, second };
  });
  expect(result).toEqual({
    failed: true,
    second: { accepted: 0, duplicate: true },
  });
  expect(observations).toHaveLength(4);
  for (const observation of observations)
    expect(observation).toEqual(observations[0]);
});
