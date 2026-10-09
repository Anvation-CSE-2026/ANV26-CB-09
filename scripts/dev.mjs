import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { startDatabase } from "./postgres.mjs";
import { useEmbeddedDatabase } from "./database-config.mjs";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const python = resolve("backend/.venv/bin/python");
const presentation = process.argv.includes("--presentation");
const mode = presentation ? "presentation" : "development";
const appEnv = { ...process.env, RUNTIME_MODE: mode };
try {
  await access(python);
} catch {
  console.error("Run npm run setup first.");
  process.exit(1);
}
const children = [];
let pg,
  stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  );
  if (pg) await pg.stop();
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop());
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    children.push(child);
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}
try {
  // Reuse the running local stack instead of starting a second PostgreSQL process.
  const existing = await Promise.all([
    fetch("http://127.0.0.1:8000/api/health", {
      signal: AbortSignal.timeout(1000),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const h = await r.json();
        return (
          h.version === "3.0.0" &&
          h.runtimeMode === mode &&
          h.capabilities?.includes("account_controls") &&
          h.capabilities?.includes("hosted_activity")
        );
      })
      .catch(() => false),
    fetch("http://127.0.0.1:4173", { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false),
  ]);
  if (existing.every(Boolean)) {
    console.log(
      `Identity Lens is already running in ${mode} mode: http://localhost:4173`,
    );
    process.exit(0);
  }
  if (existing[1]) {
    console.error(
      "An existing application is using port 4173, but its mode or another service does not match. Stop its Terminal session with Control+C, then rerun your chosen startup command.",
    );
    process.exit(1);
  }
  if (useEmbeddedDatabase(process.env.DATABASE_URL)) pg = await startDatabase();
  if (presentation) await run(resolve("node_modules/.bin/vite"), ["build"]);
  await run(python, ["-m", "alembic", "upgrade", "head"]);
  const api = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "backend.app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "--no-access-log",
    ],
    { stdio: "inherit", env: appEnv },
  );
  children.push(api);
  api.once("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8000/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready)
    throw new Error("The API did not become ready. Inspect the error above.");
  const ui = spawn(
    presentation ? process.execPath : resolve("node_modules/.bin/vite"),
    presentation ? [resolve("scripts/static-proxy.mjs")] : [],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  children.push(ui);
  ui.once("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
  console.log(
    `\nIdentity Lens (${mode}): http://localhost:4173 · Hosted activity: inside the organisation workspace · API reference: http://127.0.0.1:8000/docs`,
  );
} catch (error) {
  console.error(
    error?.message ||
      "Unable to start the local stack. Check whether PostgreSQL is already running.",
  );
  await stop(1);
}
