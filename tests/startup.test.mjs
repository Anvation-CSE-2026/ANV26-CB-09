import test from "node:test";
import assert from "node:assert/strict";
import { useEmbeddedDatabase } from "../scripts/database-config.mjs";

test("default startup uses the bundled local database", () => {
  assert.equal(useEmbeddedDatabase(undefined), true);
});

test("copying local env settings or selecting a recovery database still starts PostgreSQL", () => {
  for (const database of ["identity_lens", "lens_recovery_review"]) {
    assert.equal(
      useEmbeddedDatabase(
        `postgresql+psycopg://lens:local@127.0.0.1:55432/${database}`,
      ),
      true,
    );
    assert.equal(
      useEmbeddedDatabase(
        `postgresql://lens:local@localhost:55432/${database}`,
      ),
      true,
    );
  }
});

test("external database settings never start the bundled cluster", () => {
  for (const value of [
    "postgresql://lens:local@database.example:55432/identity_lens",
    "postgresql://lens:local@127.0.0.1:5432/identity_lens",
    "postgresql://external:local@127.0.0.1:55432/identity_lens",
  ]) {
    assert.equal(useEmbeddedDatabase(value), false);
  }
});

test("malformed or unrelated URLs cannot masquerade as the local PostgreSQL endpoint", () => {
  assert.equal(useEmbeddedDatabase("not-a-url"), false);
  assert.equal(
    useEmbeddedDatabase("https://lens:local@localhost:55432/identity_lens"),
    false,
  );
});
