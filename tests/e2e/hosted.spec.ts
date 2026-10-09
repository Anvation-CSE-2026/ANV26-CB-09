import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
let organisation: string | undefined, account: string | undefined;
const suffix = Date.now().toString();

test("hosted activity is measured after acknowledgement, stored without form values and can be withdrawn", async ({
  page,
}) => {
  const registration = await page.request.post("/api/org/register", {
    data: {
      username: `hosted-${suffix}`,
      password: "Hosted-test-password-2026",
      display_name: "Hosted test operator",
      organisation_name: `Hosted test ${suffix}`,
    },
  });
  expect(registration.status()).toBe(201);
  const owner = await registration.json();
  organisation = owner.organisationId;
  account = owner.accountId;
  const externalId = `HOSTED-${suffix}`;
  const created = await page.request.post("/api/org/cases", {
    data: {
      synthetic: true,
      external_id: externalId,
      registered_at: new Date().toISOString(),
      profile_records: [],
      sessions: [],
    },
  });
  expect(created.status()).toBe(201);
  const caseId = (await created.json()).id;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Hosted activity", exact: true })
    .click();
  await page.getByLabel("Hosted activity applicant").selectOption(caseId);
  const issuedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/org/hosted-links") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create activity link", exact: true })
    .click();
  const issued = await (await issuedResponse).json();
  await expect(
    page.getByText("Activity link ready", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open activity page", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your activity notice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start disclosed activity", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("lens-browser:"),
      ),
    ),
  ).toEqual([]);
  const before = await page.request.get(`/api/org/cases/${caseId}`);
  expect((await before.json()).assessment.band).toBe("Pending");
  await page
    .getByRole("checkbox", { name: /I acknowledge the activity notice/ })
    .check();
  await page
    .getByRole("button", { name: "Start disclosed activity", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Measuring this form only",
  );
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("lens-browser:"),
      ),
    ),
  ).toHaveLength(1);
  await page
    .getByLabel("Account purpose", { exact: true })
    .selectOption("research");
  await page
    .getByLabel("Preferred summary frequency", { exact: true })
    .selectOption("monthly");
  await page
    .getByLabel("Workspace layout", { exact: true })
    .selectOption("comfortable");
  const receivedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/hosted/complete") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Complete and submit activity", exact: true })
    .click();
  const received = await receivedResponse;
  expect(received.status()).toBe(200);
  const payload = received.request().postDataJSON();
  expect(payload.edit_count).toBe(3);
  expect(payload.form_seconds).toBeGreaterThan(0);
  expect(JSON.stringify(payload)).not.toMatch(/research|monthly|comfortable/);
  expect(Object.keys(payload).sort()).toEqual(
    [
      "ticket",
      "event_id",
      "type",
      "form_seconds",
      "edit_count",
      "collection_notice_acknowledged",
    ].sort(),
  );
  expect((await received.request().allHeaders()).cookie).toBeUndefined();
  expect(Object.keys(await received.json()).sort()).toEqual(
    ["accepted", "duplicate", "trust"].sort(),
  );
  await expect(
    page.getByRole("heading", { name: "Activity received", exact: true }),
  ).toBeVisible();
  const detail = await (
    await page.request.get(`/api/org/cases/${caseId}`)
  ).json();
  expect(detail.evidence.sessions).toHaveLength(1);
  expect(detail.evidence.sessions[0].edit_count).toBe(3);
  expect(detail.events[0].source).toBe("hosted_client_reported");
  expect(detail.assessment.band).not.toBe("Pending");
  const replay = await page.request.post("/api/hosted/complete", {
    headers: { Origin: "http://127.0.0.1:4173" },
    data: payload,
  });
  expect((await replay.json()).duplicate).toBe(true);
  await page
    .getByRole("button", { name: "Organisation workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: externalId, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Organisation navigation" })
    .getByRole("button", { name: "Hosted activity", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Received", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Measured here · client-reported", { exact: true }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(issued.token);
  await page.screenshot({ path: "test-results/hosted-activity-overview.png" });
  const another = await page.request.post("/api/org/hosted-links", {
    data: { case_id: caseId, synthetic: true },
  });
  expect(another.status()).toBe(201);
  const invitation = await another.json();
  await page.goto(`/?view=activity#access=${invitation.token}`);
  await page
    .getByRole("checkbox", { name: /I acknowledge the activity notice/ })
    .check();
  await page
    .getByRole("button", { name: "Start disclosed activity", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Measuring this form only",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/hosted-activity-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Stop without submitting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Collection stopped", exact: true }),
  ).toBeVisible();
  const afterStop = await (
    await page.request.get(`/api/org/cases/${caseId}`)
  ).json();
  expect(afterStop.evidence.sessions).toHaveLength(1);
  expect(errors).toEqual([]);
});

test.afterAll(() => {
  if (!organisation || !account) return;
  execFileSync("backend/.venv/bin/python", [
    "-c",
    `
from sqlalchemy import delete,select
from backend.app.database import *
import sys
org,account=sys.argv[1:]
with SessionLocal.begin() as db:
 ids=list(db.scalars(select(WorkspaceCase.id).where(WorkspaceCase.organisation_id==org)))
 db.execute(delete(CollectionTicket).where(CollectionTicket.case_id.in_(ids)))
 for model in [HostedAccess,EvidenceRequest,EvidenceEvent,WorkspaceAssessment,WorkspaceAudit,WorkspaceCase,WorkspaceSession,ImportBatch,Invitation,Integration,Membership]: db.execute(delete(model).where(model.organisation_id==org))
 db.execute(delete(Organisation).where(Organisation.id==org))
 db.execute(delete(Account).where(Account.id==account))
`,
    organisation,
    account,
  ]);
});
