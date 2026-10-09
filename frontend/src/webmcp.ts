import { api } from "./api";
import type { Assessment } from "./types";

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: object;
  execute: (input: { identityId?: string }) => unknown;
};
type ModelContext = {
  registerTool: (tool: Tool, options: { signal: AbortSignal }) => unknown;
};

export function registerWorkspaceTools(
  results: Map<string, Assessment>,
  onSelect: (id: string) => void,
) {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  const schema = {
    type: "object",
    properties: { identityId: { type: "string" } },
    required: ["identityId"],
    additionalProperties: false,
  };
  function check(input: { identityId?: string }) {
    if (
      !input ||
      typeof input.identityId !== "string" ||
      !results.has(input.identityId)
    )
      throw new Error("Unknown synthetic identity ID.");
    return input.identityId;
  }
  const register = (tool: Tool) =>
    Promise.resolve(
      context.registerTool(tool, { signal: controller.signal }),
    ).catch(() => {});
  register({
    name: "read_identity_assessment",
    title: "Read identity assessment",
    description:
      "Read the stored assessment and observed evidence for one synthetic identity.",
    inputSchema: schema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) {
      return api(`/cases/${check(input)}/report`);
    },
  });
  register({
    name: "open_identity_case",
    title: "Open identity case",
    description:
      "Select a synthetic identity in the visible assessment workspace.",
    inputSchema: schema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const id = check(input);
      onSelect(id);
      const result = results.get(id)!;
      return { selected: id, score: result.score, band: result.band };
    },
  });
  return () => controller.abort();
}
