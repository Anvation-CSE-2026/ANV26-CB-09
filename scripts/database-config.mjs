// A local DATABASE_URL (including a recovery database) still needs the bundled
// server. External servers must never cause a local cluster to be started.
export function useEmbeddedDatabase(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:", "postgresql+psycopg:"].includes(
        url.protocol,
      ) &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.port === "55432" &&
      url.username === "lens"
    );
  } catch {
    return false;
  }
}
