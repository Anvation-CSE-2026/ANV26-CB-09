import { spawn } from "node:child_process";
import { resolve } from "node:path";
const python = resolve(
  process.platform === "win32"
    ? "backend/.venv/Scripts/python.exe"
    : "backend/.venv/bin/python",
);
const child = spawn(
  python,
  ["-m", "backend.ops.backup", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
child.once("error", () => {
  console.error("Run npm run setup before using database tools.");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
