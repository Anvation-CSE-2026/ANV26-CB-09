import http from "node:http";
// Fixed loopback destination. No configurable open proxy or development server.
const server = http.createServer((request, response) => {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: 8000,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: "127.0.0.1:8000" },
      timeout: 30000,
    },
    (incoming) => {
      response.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(response);
      incoming.on("error", () => response.destroy());
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
  upstream.on("error", () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        detail:
          "Identity Lens is unavailable. Check the application's terminal and try again.",
      }),
    );
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
});
server.headersTimeout = 10000;
server.requestTimeout = 30000;
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "Port 4173 is already in use. Stop that terminal before starting presentation mode."
      : "The local presentation server could not start.",
  );
  process.exitCode = 1;
});
server.listen(4173, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => process.exit(0)));
