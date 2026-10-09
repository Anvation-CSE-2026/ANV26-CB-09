/* Identity Lens collector. No typed values, password/OTP events, IP or GPS capture. */
(function (global) {
  "use strict";
  function browserToken(projectId) {
    const key = "lens-browser:" + projectId;
    try {
      let token = localStorage.getItem(key);
      if (!token) {
        token = "DEV-" + crypto.randomUUID().toUpperCase();
        localStorage.setItem(key, token);
      }
      return token;
    } catch (_) {
      return "DEV-" + crypto.randomUUID().toUpperCase();
    }
  }
  function attach(options) {
    if (options.noticeAcknowledged !== true)
      throw new Error(
        "Acknowledge the collection notice before enabling measurements.",
      );
    const form =
      typeof options.form === "string"
        ? document.querySelector(options.form)
        : options.form;
    if (!(form instanceof HTMLFormElement))
      throw new Error("A registration form is required.");
    if (!options.ticket || !options.endpoint)
      throw new Error(
        "A short-lived server-issued ticket and collection endpoint are required.",
      );
    let edits = 0,
      stopped = false,
      completedPayload = null;
    const started = performance.now();
    const eventId = crypto.randomUUID();
    const onChange = (event) => {
      const target = event.target;
      if (!(
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ))
        return;
      if (target instanceof HTMLInputElement && target.type === "password")
        return;
      if (
        /one-time-code|current-password|new-password/.test(
          target.autocomplete || "",
        )
      )
        return;
      if (target.closest("[data-lens-ignore]")) return;
      edits = Math.min(200, edits + 1);
    };
    const stop = () => {
      stopped = true;
      form.removeEventListener("change", onChange);
    };
    const complete = async () => {
      if (stopped) throw new Error("The collector has stopped.");
      const payload =
        completedPayload ||
        (completedPayload = {
          ticket: options.ticket,
          event_id: eventId,
          type: "form_completed",
          form_seconds: Math.min(
            1800,
            Math.max(0, (performance.now() - started) / 1000),
          ),
          edit_count: edits,
          collection_notice_acknowledged: true,
        });
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          response = await fetch(options.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "omit",
            keepalive: true,
            signal: controller.signal,
          });
          if (response.ok) {
            stop();
            return await response.json();
          }
          if (response.status < 500)
            throw new Error("Collection rejected (" + response.status + ").");
        } catch (error) {
          if (response && response.status < 500) throw error;
          if (attempt === 2) throw error;
        } finally {
          clearTimeout(timeout);
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
      }
      throw new Error("Collection delivery could not be confirmed.");
    };
    form.addEventListener("change", onChange);
    return { complete, stop };
  }
  global.IdentityLens = Object.freeze({ browserToken, attach });
})(window);
