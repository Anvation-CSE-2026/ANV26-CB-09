const endpoints = document.querySelector("#endpoints");
const status = document.querySelector("#status");
const schemas = document.querySelector("#schemas");
const search = document.querySelector("#search");
function details(title, value) {
  const item = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(value, null, 2);
  item.append(summary, pre);
  return item;
}
fetch("/openapi.json")
  .then(async (response) => {
    if (!response.ok) throw new Error("Schema unavailable");
    const spec = await response.json();
    let count = 0;
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!["get", "post", "put", "delete", "patch"].includes(method))
          continue;
        const title =
          method.toUpperCase() +
          "  " +
          path +
          "  ·  " +
          (operation.summary || "");
        const item = details(title, operation);
        item.dataset.search = (
          title +
          " " +
          (operation.tags || []).join(" ")
        ).toLowerCase();
        endpoints.append(item);
        count++;
      }
    }
    for (const [name, schema] of Object.entries(spec.components?.schemas || {}))
      schemas.append(details(name, schema));
    status.textContent =
      count + " endpoints · API version " + spec.info.version;
  })
  .catch(() => {
    status.textContent =
      "The API schema could not be loaded. Check the application and refresh.";
  });
search.addEventListener("input", () => {
  const query = search.value.trim().toLowerCase();
  for (const item of endpoints.children)
    item.hidden = !item.dataset.search.includes(query);
});
