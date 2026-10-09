import { test, expect } from "@playwright/test";
test("collector counts form changes while excluding typed secrets and values", async ({
  page,
}) => {
  let payload: Record<string, unknown> | null = null;
  await page.route("**/api/collect/events", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accepted: 1 }),
    });
  });
  await page.goto("/");
  await page.addScriptTag({ url: "/identity-lens.js" });
  const result = await page.evaluate(async () => {
    const collector = (
      window as unknown as {
        IdentityLens: {
          browserToken: (project: string) => string;
          attach: (options: Record<string, unknown>) => {
            complete: () => Promise<unknown>;
          };
        };
      }
    ).IdentityLens;
    const form = document.createElement("form");
    form.id = "synthetic-registration";
    form.innerHTML =
      '<input name="display" value="Fictional Applicant"><select><option>North</option></select><input type="password" value="secret-password"><input autocomplete="one-time-code" value="123456"><input data-lens-ignore value="private-value">';
    document.body.append(form);
    let rejectedWithoutNotice = false;
    try {
      collector.attach({
        form,
        ticket: "synthetic-test-ticket",
        endpoint: "/api/collect/events",
        noticeAcknowledged: false,
      });
    } catch {
      rejectedWithoutNotice = true;
    }
    const attached = collector.attach({
      form,
      ticket: "synthetic-test-ticket",
      endpoint: "/api/collect/events",
      noticeAcknowledged: true,
    });
    form
      .querySelectorAll("input,select")
      .forEach((element) =>
        element.dispatchEvent(new Event("change", { bubbles: true })),
      );
    await attached.complete();
    form.remove();
    return {
      rejectedWithoutNotice,
      stable:
        collector.browserToken("project-a") ===
        collector.browserToken("project-a"),
      isolated:
        collector.browserToken("project-a") !==
        collector.browserToken("project-b"),
    };
  });
  expect(result).toEqual({
    rejectedWithoutNotice: true,
    stable: true,
    isolated: true,
  });
  expect(payload).toMatchObject({
    type: "form_completed",
    edit_count: 2,
    collection_notice_acknowledged: true,
  });
  expect(Object.keys(payload!)).toEqual([
    "ticket",
    "event_id",
    "type",
    "form_seconds",
    "edit_count",
    "collection_notice_acknowledged",
  ]);
  expect(JSON.stringify(payload)).not.toMatch(
    /Fictional Applicant|secret-password|123456|private-value/,
  );
});
