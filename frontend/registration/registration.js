const form = document.querySelector("#registration");
const submit = document.querySelector("#submit");
const result = document.querySelector("#result");
const connection = document.querySelector("#connection");
const refresh = document.querySelector("#refresh-connection");
let connected = false;
let busy = false;
const now = new Date();
document.querySelector("#registered").value = new Date(
  now.getTime() - now.getTimezoneOffset() * 60000,
)
  .toISOString()
  .slice(0, -1);
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail
                .slice(0, 3)
                .map(
                  (item) =>
                    (item.loc || []).filter((k) => k !== "body").join(".") +
                    ": " +
                    item.msg,
                )
                .join("; ")
            : "The server could not accept this evidence.";
      throw new Error(detail);
    }
    return data;
  } catch (error) {
    if (error instanceof TypeError || controller.signal.aborted)
      throw new Error(
        "Delivery could not be confirmed. Check the application and retry the identical ID and evidence.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function checkConnection() {
  refresh.disabled = true;
  submit.disabled = true;
  connection.textContent = "Checking the server connection…";
  try {
    const data = await api("/api/connection");
    connected = true;
    connection.textContent =
      "Connected to " + data.organisationName + " · " + data.integrationName;
  } catch (error) {
    connected = false;
    connection.textContent = error.message;
  } finally {
    refresh.disabled = false;
    submit.disabled = !connected || busy;
  }
}
refresh.addEventListener("click", checkConnection);
checkConnection();
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !connected) return;
  busy = true;
  submit.disabled = true;
  result.hidden = true;
  // Lock source values until delivery is confirmed; retain them for an identical retry.
  const fields = new FormData(form);
  const controls = form.querySelectorAll("input,select");
  controls.forEach((control) => {
    control.disabled = true;
  });
  const payload = { synthetic: true };
  for (const key of [
    "external_id",
    "phone_token",
    "address_token",
    "device_token",
    "region",
    "observed_region",
  ])
    payload[key] = fields.get(key) || null;
  payload.registered_at = new Date(fields.get("registered_at")).toISOString();
  for (const key of [
    "birth_year",
    "email_age_days",
    "form_seconds",
    "edit_count",
    "failed_attempts",
  ])
    payload[key] = fields.get(key) === "" ? null : Number(fields.get(key));
  for (const key of ["phone_verified", "emulated_device", "device_mismatch"])
    payload[key] = fields.get(key) === "" ? null : fields.get(key) === "true";
  payload.add_session = fields.has("add_session");
  try {
    const data = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    result.className = "result";
    result.textContent =
      "Registration " +
      data.externalId +
      " delivered. " +
      data.observationsAccepted +
      " new session observations accepted." +
      (data.duplicateRegistration
        ? " This registration was already received; no duplicate was created."
        : "") +
      " Open Investigations and Refresh in the analyst workspace.";
  } catch (error) {
    result.className = "result error";
    result.textContent = error.message;
  } finally {
    busy = false;
    result.hidden = false;
    controls.forEach((control) => {
      control.disabled = false;
    });
    submit.disabled = !connected;
  }
});
