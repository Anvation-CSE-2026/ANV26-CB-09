import { access } from "node:fs/promises";
import { resolve } from "node:path";
const checks = [];
async function check(name, action) {
  try {
    const detail = await action();
    checks.push({ name, ok: true });
    console.log(`PASS · ${name}${detail ? " · " + detail : ""}`);
  } catch {
    checks.push({ name, ok: false });
    console.log(`FAIL · ${name}`);
  }
}
async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error("not_ready");
  return r;
}
await check("Python environment installed", () =>
  access(resolve("backend/.venv/bin/python")),
);
await check("Frontend build present", () => access(resolve("dist/index.html")));
await check("Main application responds", async () => {
  await get("http://127.0.0.1:4173/");
});
await check("Original sample cases remain available", async () => {
  await get("http://127.0.0.1:4173/sandbox");
});
await check("API and PostgreSQL healthy", async () => {
  const h = await (await get("http://127.0.0.1:8000/api/health")).json();
  if (h.status !== "ok" || h.database !== "postgresql")
    throw new Error("not_ready");
  return h.runtimeMode || "local";
});
await check("Hosted activity capability enabled", async () => {
  const h = await (await get("http://127.0.0.1:8000/api/health")).json();
  if (!h.capabilities?.includes("hosted_activity") || !h.hostedActivityEnabled)
    throw new Error("not_enabled");
  await get("http://127.0.0.1:4173/identity-lens.js");
  return "notice-gated, fictional applicants";
});
console.log(
  `${checks.filter((c) => c.ok).length}/${checks.length} checks passed. This checks readiness, not fraud accuracy or production certification.`,
);
process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
