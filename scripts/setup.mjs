import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const python =
  process.platform === "win32"
    ? "backend/.venv/Scripts/python.exe"
    : "backend/.venv/bin/python";
function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
if (!existsSync(python)) run("python3", ["-m", "venv", "backend/.venv"]);
run(python, ["-m", "pip", "install", "-r", "backend/requirements.lock.txt"]);
console.log("Setup complete. Run npm start.");
