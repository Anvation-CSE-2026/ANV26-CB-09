import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
afterEach(() => vi.unstubAllGlobals());
describe("API boundary", () => {
  it("explains an unavailable backend without exposing raw browser exceptions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("raw transport failure")),
    );
    await expect(api("/org/me")).rejects.toMatchObject({
      status: 0,
      message:
        "Cannot reach Identity Lens. Check that the application is running, then try again.",
    });
  });
  it("returns a support reference for server failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: "Service temporarily unavailable." }),
            { status: 503, headers: { "X-Request-ID": "test-reference" } },
          ),
        ),
    );
    await expect(api("/org/me")).rejects.toMatchObject({
      status: 503,
      requestId: "test-reference",
      message: "Service temporarily unavailable. Reference: test-reference.",
    });
  });
  it("sends review mutations with same-origin session credentials", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ revision: 2 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await api("/cases/CASE-002/review", {
        method: "PUT",
        body: JSON.stringify({ status: "In review", revision: 1 }),
      }),
    ).toEqual({ revision: 2 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/cases/CASE-002/review");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers.get("Content-Type")).toBe("application/json");
  });
  it("preserves a conflict response so the UI cannot report a failed save as successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: "Another analyst updated this case." }),
            { status: 409 },
          ),
        ),
    );
    await expect(api("/cases/CASE-002/review")).rejects.toMatchObject({
      status: 409,
      message: "Another analyst updated this case.",
    });
  });
  it("handles sign-out with an empty response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    expect(await api("/auth/logout", { method: "POST" })).toBeUndefined();
  });
  it("turns structured validation errors into readable messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: [
              {
                loc: ["body", "registered_at"],
                msg: "Timestamp requires a timezone.",
                input: "never echo raw input",
              },
            ],
          }),
          {
            status: 422,
          },
        ),
      ),
    );
    await expect(api("/cases/CASE-002/review")).rejects.toMatchObject({
      status: 422,
      message: "registered_at: Timestamp requires a timezone.",
    });
  });
});
