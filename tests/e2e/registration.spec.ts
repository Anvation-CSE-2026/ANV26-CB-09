import { test, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
const suffix = Date.now().toString();
let service: ChildProcess | undefined;
let org: string | undefined, account: string | undefined;

test("a separate registration server delivers browser submissions without exposing keys or verdicts", async ({
  page,
}) => {
  const response = await page.request.post("/api/org/register", {
    data: {
      username: `portal-${suffix}`,
      password: "Portal-test-password-2026",
      display_name: "Portal browser test",
      organisation_name: `Portal test ${suffix}`,
    },
  });
  expect(response.status()).toBe(201);
  const owner = await response.json();
  org = owner.organisationId;
  account = owner.accountId;
  const created = await page.request.post("/api/org/integrations", {
    data: {
      name: "Standalone browser test",
      origins: ["http://127.0.0.1:4181"],
    },
  });
  expect(created.status()).toBe(201);
  const integration = await created.json();
  service = spawn(
    "backend/.venv/bin/python",
    [
      "-m",
      "uvicorn",
      "backend.registration:app",
      "--host",
      "127.0.0.1",
      "--port",
      "4181",
      "--no-access-log",
    ],
    {
      env: {
        ...process.env,
        LENS_REGISTRATION_API: "http://127.0.0.1:8000",
        LENS_REGISTRATION_KEY: integration.secret,
        LENS_REGISTRATION_PORT: "4181",
      },
      stdio: "ignore",
    },
  );
  await expect
    .poll(async () => {
      try {
        return (await fetch("http://127.0.0.1:4181/api/health")).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  const leaks: string[] = [];
  page.on("request", (r) => {
    if (
      r.postData()?.includes(integration.secret) ||
      Object.values(r.headers()).some((v) => v.includes(integration.secret))
    )
      leaks.push(r.url());
  });
  await page.goto("http://127.0.0.1:4181/");
  await expect(page.locator("#connection")).toContainText(
    `Portal test ${suffix}`,
  );
  expect(await page.locator("body").innerText()).not.toContain(
    integration.secret,
  );
  await page
    .getByLabel("Applicant ID", { exact: true })
    .fill(`PORTAL-${suffix}`);
  await page
    .getByLabel("Registration timestamp", { exact: true })
    .fill("2026-10-01T14:30");
  await page
    .getByRole("checkbox", { name: /Attach a supplied\s+synthetic session/ })
    .check();
  await page
    .getByLabel("Device token", { exact: true })
    .fill("DEV-PORTAL-BROWSER");
  await page
    .getByLabel("Supplied form duration (seconds)", { exact: true })
    .fill("190");
  await page.getByLabel("Supplied field changes", { exact: true }).fill("4");
  await page
    .getByRole("checkbox", {
      name: /I confirm these\s+applicant observations are fictional/,
    })
    .check();
  const delivered = page.waitForResponse(
    (r) => r.url().endsWith("/api/register") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Submit registration", exact: true })
    .click();
  const first = await delivered;
  expect(first.status()).toBe(200);
  expect(Object.keys(await first.json()).sort()).toEqual(
    [
      "submitted",
      "externalId",
      "syntheticOnly",
      "observationsAccepted",
      "duplicateRegistration",
    ].sort(),
  );
  await expect(page.locator("#result")).toContainText(
    "1 new session observations accepted",
  );
  await page
    .getByRole("button", { name: "Submit registration", exact: true })
    .click();
  await expect(page.locator("#result")).toContainText(
    "no duplicate was created",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/connected-registration-mobile.png",
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:4173/");
  await expect(
    page.getByRole("heading", { name: "Investigations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `PORTAL-${suffix}`, exact: true })
    .click();
  await expect(
    page.getByText("Evidence is incomplete", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("server integration", { exact: true }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
  expect(leaks).toEqual([]);
});

test.afterAll(async () => {
  if (service && service.exitCode === null) {
    service.kill("SIGTERM");
    await new Promise((resolve) => service!.once("exit", resolve));
  }
  if (!org || !account) return;
  execFileSync("backend/.venv/bin/python", [
    "-c",
    `
from sqlalchemy import select,delete
from backend.app.database import SessionLocal,Organisation,Account,Membership,WorkspaceSession,Invitation,Integration,WorkspaceCase,WorkspaceAssessment,WorkspaceAudit,EvidenceEvent,CollectionTicket,ImportBatch,EvidenceRequest,RecoveryEmail,EmailAction
import sys
org,account=sys.argv[1:]
with SessionLocal.begin() as db:
 ids=list(db.scalars(select(WorkspaceCase.id).where(WorkspaceCase.organisation_id==org)))
 db.execute(delete(CollectionTicket).where(CollectionTicket.case_id.in_(ids)))
 for model in [EvidenceRequest,EvidenceEvent,WorkspaceAssessment,WorkspaceAudit,WorkspaceCase,WorkspaceSession,ImportBatch,Invitation,Integration,Membership]: db.execute(delete(model).where(model.organisation_id==org))
 db.execute(delete(Organisation).where(Organisation.id==org))
 for model in [EmailAction,RecoveryEmail]: db.execute(delete(model).where(model.account_id==account))
 db.execute(delete(Account).where(Account.id==account))
`,
    org,
    account,
  ]);
});
