import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
const suffix = Date.now().toString();
const organisations: string[] = [];
const accounts: string[] = [];

test("organisation onboarding, imports, investigations, correction and connections", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("Organisation name", { exact: true })
    .fill(`Evidence team ${suffix}`);
  await page.getByLabel("Your display name").fill("Browser test administrator");
  await page.getByLabel("Username", { exact: true }).fill(`browser-${suffix}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("A-browser-test-password-2026");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/org/register") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create organisation", exact: true })
    .click();
  const account = await (await response).json();
  organisations.push(account.organisationId);
  accounts.push(account.accountId);
  await expect(
    page.getByRole("heading", { name: "Investigations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your workspace starts with your evidence.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import your first dataset" }).click();
  const sample = await (
    await page.request.get("/api/org/sample-dataset")
  ).json();
  await page
    .getByLabel("Dataset name", { exact: true })
    .fill("synthetic-browser-test.json");
  await page
    .getByLabel("Dataset contents", { exact: true })
    .fill(JSON.stringify(sample));
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Import preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import validated dataset" }).click();
  await expect(page.getByRole("status")).toContainText("imported and assessed");
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Method & validation", exact: true })
    .click();
  await expect(
    page.getByText("Full scoring policy", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Profile-conflict baseline", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Without Identity consistency", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Compare cases", exact: true })
    .click();
  const workspaceRows: { externalId: string; id: string }[] = await (
    await page.request.get("/api/org/cases")
  ).json();
  for (let i = 1; i <= 3; i++) {
    await page
      .getByLabel(`Comparison applicant ${i}`)
      .selectOption(
        workspaceRows.find((r) => r.externalId === `CASE-00${i}`)!.id,
      );
  }
  await expect(
    page.locator(".org-comparison-card .org-big-score").nth(0),
  ).toHaveText(/^0\s*\/\s*100$/);
  await expect(
    page.locator(".org-comparison-card .org-big-score").nth(1),
  ).toHaveText(/^32\s*\/\s*100$/);
  await expect(
    page.locator(".org-comparison-card .org-big-score").nth(2),
  ).toHaveText(/^100\s*\/\s*100$/);
  await expect(
    page.getByRole("heading", { name: "What could change this assessment?" }),
  ).toHaveCount(3);
  await page.screenshot({
    path: "test-results/organisation-comparison.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "All applicants", exact: true })
    .click();
  await page.getByRole("button", { name: "CASE-003", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "CASE-003", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".org-big-score")).toContainText("100");
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Please clarify the linked contact records.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByText("Please clarify the linked contact records.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Relationships", exact: true }).click();
  await expect(page.locator(".cy-graph canvas").first()).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Event provenance" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Correct evidence", exact: true })
    .click();
  await page
    .getByLabel("Emulated environment", { exact: true })
    .selectOption("false");
  await page
    .getByLabel("Device attribute mismatch", { exact: true })
    .selectOption("false");
  await page
    .getByLabel("Birth year · record 2", { exact: true })
    .fill(
      await page
        .getByLabel("Birth year · record 1", { exact: true })
        .inputValue(),
    );
  await page
    .getByLabel("Region · record 2", { exact: true })
    .selectOption(
      await page.getByLabel("Region · record 1", { exact: true }).inputValue(),
    );
  await page
    .getByLabel("Source · record 2", { exact: true })
    .fill("Corrected verification");
  await page
    .getByLabel("Reason for correction", { exact: true })
    .fill("Corrected supplied verification and device evidence.");
  await page
    .getByRole("button", { name: "Save correction and reassess" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".org-big-score")).toHaveText(/^72\s*\/\s*100$/);
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Assessment history" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  const connectionCreated = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/org/integrations") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create integration key" }).click();
  const integration = await (await connectionCreated).json();
  await expect(
    page.getByText("Save this key before leaving this page", { exact: true }),
  ).toBeVisible();
  // APIRequestContext runs in the test's server process, not in website JavaScript.
  const keyHeaders = { "X-Lens-Key": integration.secret };
  const externalId = `CONNECTED-${suffix}`;
  const intake = await page.request.post("/api/ingest/cases", {
    headers: keyHeaders,
    data: {
      synthetic: true,
      external_id: externalId,
      registered_at: "2026-10-01T09:00:00Z",
      profile_records: [],
      sessions: [],
    },
  });
  expect(intake.status()).toBe(201);
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: externalId, exact: true }).click();
  await expect(
    page.getByText("No risk verdict has been assigned.", { exact: false }),
  ).toBeVisible();
  const delivered = await page.request.post(
    `/api/ingest/cases/${externalId}/sessions`,
    {
      headers: keyHeaders,
      data: {
        synthetic: true,
        sessions: [
          {
            event_id: "SERVER-EVENT-001",
            timestamp: "2026-10-01T09:05:00Z",
            device_token: "DEV-SERVER-CONNECTION",
            form_seconds: 190,
            edit_count: 4,
          },
        ],
      },
    },
  );
  expect(delivered.status()).toBe(200);
  expect((await delivered.json()).accepted).toBe(1);
  await page
    .getByRole("button", { name: "All applicants", exact: true })
    .click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: externalId, exact: true }).click();
  await expect(page.locator(".org-big-score")).toHaveText(/^0\s*\/\s*100$/);
  await expect(
    page.getByText("Coverage describes available inputs", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("server integration", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replay scenario", exact: true })
    .count()
    .then((count) => expect(count).toBe(0));
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Your team", exact: true })
    .click();
  await page.getByLabel("Invitation role").selectOption("viewer");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Copy invitation link" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/organisation-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "CASE-003", exact: true }),
  ).toBeVisible();
  const ownBefore = await (await page.request.get("/api/org/me")).json();
  const populationBefore = await (
    await page.request.get("/api/org/cases")
  ).json();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Sample cases", exact: true })
    .click();
  await expect(page).toHaveURL(/\?view=showcase$/);
  await page
    .getByRole("button", { name: "Open sample cases", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Compare sample cases", exact: true })
    .click();
  await expect(page.locator(".compare-card")).toHaveCount(3);
  await page.screenshot({ path: "test-results/unified-showcase.png" });
  await page
    .locator(".header-actions")
    .getByRole("button", { name: "Organisation workspace", exact: true })
    .click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(
    page.getByRole("button", { name: "CASE-003", exact: true }),
  ).toBeVisible();
  expect(await (await page.request.get("/api/org/me")).json()).toEqual(
    ownBefore,
  );
  expect(await (await page.request.get("/api/org/cases")).json()).toEqual(
    populationBefore,
  );
  await page.goBack();
  await expect(
    page
      .locator(".header-actions")
      .getByRole("button", { name: "Organisation workspace", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Investigations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add applicant", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add applicant evidence" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Applicant ID", { exact: true })
    .fill(`FORM-${suffix}`);
  await dialog
    .getByLabel("Phone verification", { exact: true })
    .selectOption("");
  const added = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/org/cases") && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Save applicant", exact: true })
    .click();
  expect((await added).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: `FORM-${suffix}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No risk verdict has been assigned.", { exact: false }),
  ).toBeVisible();
  await page.getByText("Request additional evidence", { exact: true }).click();
  await page
    .getByLabel("What evidence is needed?", { exact: true })
    .fill("Please supply a comparable fictional profile source record.");
  await page
    .getByRole("button", { name: "Create evidence request", exact: true })
    .click();
  const request = page.locator(".org-request-card").first();
  await expect(request.getByText("Open", { exact: true })).toBeVisible();
  await request.getByText("Close this request", { exact: true }).click();
  await request
    .getByLabel("Resolution note · Profile comparison", { exact: true })
    .fill("Test follow-up recorded; source correction remains separate.");
  await request
    .getByRole("button", {
      name: "Close Profile comparison request",
      exact: true,
    })
    .click();
  await expect(request.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No risk verdict has been assigned.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account security", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Active sessions", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("This session", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send verification link", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Add applicant", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((e) => e.getBoundingClientRect().width <= innerWidth),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.screenshot({
    path: "test-results/organisation-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/organisation-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test.afterAll(() => {
  if (!organisations.length) return;
  // Remove only the exact organisations/accounts created by this test run.
  execFileSync(
    "backend/.venv/bin/python",
    [
      "-c",
      `
import json,sys
from sqlalchemy import delete,select
from backend.app.database import *
orgs,accounts=json.loads(sys.argv[1]),json.loads(sys.argv[2])
with SessionLocal.begin() as db:
    integrations=list(db.scalars(select(Integration.id).where(Integration.organisation_id.in_(orgs))))
    db.execute(delete(CollectionTicket).where(CollectionTicket.integration_id.in_(integrations)))
    for model in [EvidenceRequest,EvidenceEvent,WorkspaceAssessment,WorkspaceAudit,ImportBatch,WorkspaceCase,Invitation,Integration,WorkspaceSession,Membership]:
        db.execute(delete(model).where(model.organisation_id.in_(orgs)))
    db.execute(delete(Organisation).where(Organisation.id.in_(orgs)))
    db.execute(delete(Account).where(Account.id.in_(accounts)))
`,
      JSON.stringify(organisations),
      JSON.stringify(accounts),
    ],
    { stdio: "pipe" },
  );
});
