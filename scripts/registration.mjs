import { spawn } from "node:child_process";
import { resolve } from "node:path";
const python = resolve("backend/.venv/bin/python");
const configure = process.argv[2] === "configure";
const connect = process.argv[2] === "connect";
const args = connect
  ? ["-m", "backend.ops.connect_registration", ...process.argv.slice(3)]
  : configure
    ? ["-m", "backend.registration"]
    : [
        "-m",
        "uvicorn",
        "backend.registration:app",
        "--host",
        "127.0.0.1",
        "--port",
        "4180",
      ];
const child = spawn(python, args, { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", () => {
  console.error("Run npm run setup first.");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
