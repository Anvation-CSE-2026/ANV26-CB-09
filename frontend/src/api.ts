export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      signal: init.signal || controller.signal,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(
      0,
      controller.signal.aborted
        ? "The request took too long. Refresh to check whether it completed before retrying."
        : "Cannot reach Identity Lens. Check that the application is running, then try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ detail: "The server is unavailable. Try again." }));
    let message = "Some fields are invalid. Check your input.";
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail))
      message =
        body.detail
          .slice(0, 3)
          .map((item: { loc?: unknown[]; msg?: string }) => {
            const field = (item.loc || [])
              .filter((v) => v !== "body")
              .join(".");
            return (field ? field + ": " : "") + (item.msg || "Invalid field");
          })
          .join("; ") || message;
    else if (typeof body.detail?.message === "string")
      message = body.detail.message;
    const requestId = response.headers.get("X-Request-ID") || undefined;
    if (response.status >= 500 && requestId)
      message += ` Reference: ${requestId}.`;
    throw new ApiError(response.status, message, requestId);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
