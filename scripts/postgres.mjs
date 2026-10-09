import EmbeddedPostgres from "embedded-postgres";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
export async function startDatabase() {
  const dir = resolve(".local/postgres");
  await mkdir(resolve(".local"), { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "lens",
    password: "lens_local_only",
    port: 55432,
    persistent: true,
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: (message) => {
      if (
        String(message).includes("FATAL") ||
        String(message).includes("ERROR")
      )
        console.error(String(message));
    },
  });
  const existing = pg.getPgClient("postgres", "127.0.0.1");
  try {
    await existing.connect();
    const state = await existing.query("SHOW data_directory");
    if (resolve(state.rows[0].data_directory) !== dir) {
      throw new Error(
        "Port 55432 belongs to a different database cluster. Check your connection settings; no server was stopped.",
      );
    }
    console.log(
      "Existing local PostgreSQL reused. It will remain running when this app stops.",
    );
    return { stop: async () => {} };
  } catch (error) {
    if (error.code !== "ECONNREFUSED") {
      if (String(error.message).startsWith("Port 55432")) throw error;
      throw new Error(
        "Could not safely connect to the database on port 55432. Check the existing database before restarting.",
      );
    }
  } finally {
    await existing.end().catch(() => {});
  }
  try {
    await access(resolve(dir, "PG_VERSION"));
  } catch {
    await pg.initialise();
  }
  await pg.start();
  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  const result = await client.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    ["identity_lens"],
  );
  if (!result.rowCount) await client.query("CREATE DATABASE identity_lens");
  await client.end();
  console.log("PostgreSQL ready. Persistent data: .local/postgres");
  return pg;
}
if (process.argv[1]?.endsWith("/postgres.mjs")) {
  const pg = await startDatabase();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await pg.stop();
      process.exit(0);
    });
  await new Promise(() => {});
}
