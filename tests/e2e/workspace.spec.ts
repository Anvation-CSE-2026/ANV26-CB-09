import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
const note = `Browser persistence check ${Date.now()}`;
let originalReview: unknown = null;
let intakeId: string | null = null;
test("an open sample view can load relationships after the frontend is rebuilt", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=showcase");
  await page
    .getByRole("button", { name: "Open sample cases", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A clearer picture of identity risk.",
      exact: true,
    }),
  ).toBeVisible();
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    { stdio: "pipe" },
  );
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    stdio: "pipe",
  });
  await page.getByRole("tab", { name: /^Relationships/ }).click();
  await expect(page.locator(".cy-graph canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});
test("comparison, graph, sensitivity and projector mode preserve the demo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "Open sample cases" }).click();
  await expect(
    page.getByRole("heading", { name: "A clearer picture of identity risk." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare sample cases" }).click();
  const cards = page.locator(".compare-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).locator(".risk-number")).toHaveText("0");
  await expect(cards.nth(1).locator(".risk-number")).toHaveText("32");
  await expect(cards.nth(2).locator(".risk-number")).toHaveText("100");
  await cards
    .nth(2)
    .getByRole("button", { name: "Inspect complete case" })
    .click();
  await page.getByRole("tab", { name: /Relationships/ }).click();
  await expect(page.locator(".cy-graph canvas").first()).toBeVisible();
  await page.getByRole("tab", { name: /Profile & activity/ }).click();
  await expect(
    page.getByRole("heading", { name: "Behavioural profile & activity" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Risk indicators/ }).click();
  for (const checkbox of await page.locator(".sim-choice input").all())
    await checkbox.check();
  await expect(page.locator(".sim-result")).toContainText("Simulated 0");
  await expect(page.locator(".detail-top .risk-number")).toHaveText("100");
  await page
    .getByRole("button", { name: "Presentation mode", exact: true })
    .click();
  await expect(page.locator("body")).toHaveClass(/presentation/);
  await page.getByRole("button", { name: "Exit presentation" }).click();
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "A clearer picture of identity risk." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("analyst notes survive refresh and read-only sessions cannot save", async ({
  page,
}) => {
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "Open sample cases" }).click();
  const search = page.getByRole("searchbox", {
    name: "Search by identity ID or name",
  });
  await search.fill("ID-100");
  await page.locator(".case-row").click();
  originalReview = await (
    await page.request.get("/api/cases/ID-100/review")
  ).json();
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("Needs evidence");
  await page.getByRole("textbox", { name: "Investigation note" }).fill(note);
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByText("Review saved. It will remain available after refresh."),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("searchbox").fill("ID-100");
  await page.locator(".case-row").click();
  await expect(
    page.getByRole("textbox", { name: "Investigation note" }),
  ).toHaveValue("");
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Review status", { exact: true })).toHaveValue(
    "Needs evidence",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await page
    .getByRole("button", { name: "Explore with read-only access" })
    .click();
  await expect(
    page.getByRole("button", { name: "Save review" }),
  ).toBeDisabled();
});
test.afterAll(() => {
  // Remove only the exact note this test created, and its associated audit revision.
  execFileSync("backend/.venv/bin/python", [
    "-c",
    `import sys,json\nfrom datetime import datetime\nfrom backend.app.database import SessionLocal,Note,Review,Audit,Identity,Assessment,Observation,EntityLink\nfrom sqlalchemy import select,delete\ns=json.loads(sys.argv[1])\nwith SessionLocal.begin() as db:\n before=s['originalReview']\n if before:\n  notes=db.scalars(select(Note).where(Note.identity_id=='ID-100',Note.text==s['note'])).all()\n  r=db.get(Review,'ID-100')\n  for n in notes: db.delete(n)\n  if notes and r.revision==before['revision']+1:\n   db.execute(delete(Audit).where(Audit.identity_id=='ID-100',Audit.actor=='Demo analyst',Audit.details['revision'].as_integer()==r.revision))\n   r.status=before['status'];r.revision=before['revision'];r.updated_by=before['updatedBy'];r.updated_at=datetime.fromisoformat(before['updatedAt'])\n if s['intakeId']:\n  id=s['intakeId']\n  r=db.get(Review,id)\n  if r and r.revision==0:\n   a=db.scalar(select(Audit).where(Audit.identity_id==id,Audit.action=='synthetic_case_created'))\n   if a:\n    db.execute(delete(Assessment).where(Assessment.id.in_(a.details['assessmentIds'])))\n    for table in [Note,Audit,Observation,EntityLink,Review]: db.execute(delete(table).where(table.identity_id==id))\n    db.execute(delete(Identity).where(Identity.id==id))\n`,
    JSON.stringify({ note, originalReview, intakeId }),
  ]);
});
test("new synthetic evidence is stored and assessed through the frontend", async ({
  page,
}) => {
  await page.goto("/sandbox");
  await page.getByRole("button", { name: "Open sample cases" }).click();
  await page
    .getByRole("button", { name: "Add synthetic case", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add a synthetic case" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email age at registration (days)").fill("3");
  await dialog
    .getByLabel("Verification birth year", { exact: true })
    .fill("1997");
  await page.screenshot({ path: "test-results/intake-form.png" });
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/cases") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create and assess" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = await response.json();
  intakeId = created.identity.id;
  await expect(page.locator(".case-heading h2")).toHaveText(
    created.identity.displayName,
  );
  await expect(page.locator(".detail-top .risk-number")).toHaveText(
    String(created.assessment.score),
  );
  await page.reload();
  await page.getByRole("searchbox").fill(intakeId!);
  await page.locator(".case-row").click();
  await expect(page.locator(".case-heading h2")).toHaveText(
    created.identity.displayName,
  );
});
