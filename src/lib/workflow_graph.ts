// The canvas edits the same declarative definition as JSON/Python/MCP.
// Layout is UI state only; connections always follow the server's forward-only rules.
export type WorkflowStep = { id: string; type: string; [key: string]: any };
export type WorkflowSpec = { name: string; steps: WorkflowStep[]; [key: string]: any };
export type FlowEdge = { from: string; to: string; label: string };

export function parseWorkflow(text: string): WorkflowSpec | null {
  try {
    const value = JSON.parse(text);
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray(value.steps) &&
      value.steps.every(
        (step: any) =>
          step &&
          typeof step === "object" &&
          typeof step.id === "string" &&
          step.id.length &&
          typeof step.type === "string",
      ) &&
      new Set(value.steps.map((step: WorkflowStep) => step.id)).size === value.steps.length
      ? value
      : null;
  } catch {
    return null;
  }
}

export function flowEdges(steps: WorkflowStep[]): FlowEdge[] {
  // Membership by Set, not `steps.some`: the per-edge scan made a 20 000-step spec take
  // 1.3 s of blocking work on the main thread for a spec the canvas re-derives on every edit.
  const ids = new Set(steps.map((step) => step.id));
  return steps
    .flatMap((step, index) =>
      step.type === "branch"
        ? [
            { from: step.id, to: step.then, label: "Yes" },
            { from: step.id, to: step.else, label: "No" },
          ]
        : [{ from: step.id, to: steps[index + 1]?.id ?? "end", label: "" }],
    )
    .filter((edge) => edge.to === "end" || ids.has(edge.to));
}

export function newStep(
  type: string,
  steps: WorkflowStep[],
  inputs: Record<string, any> = {},
): WorkflowStep {
  let suffix = 1;
  while (steps.some((step) => step.id === `${type}_${suffix}`)) suffix++;
  const base = { id: `${type}_${suffix}`, type };
  const input = Object.keys(inputs).find((key) => inputs[key]?.type === "string");
  const text = input ? { $input: input } : "Enter text here";
  const earlier = steps.findLast((step) => step.type === "perceive");
  const questionId = Object.keys(earlier?.questions ?? {})[0];
  const question = earlier?.questions?.[questionId];
  const preview = steps.findLast((step) => step.type === "document_preview");
  if (type === "perceive")
    return {
      ...base,
      backend: "local:npu",
      state: { message: text },
      questions: { relevant: { type: "noul", instructions: "Does `message` ask for help?" } },
    };
  if (type === "branch")
    return {
      ...base,
      condition: {
        step: earlier?.id ?? "",
        question: questionId ?? "",
        field:
          question?.type === "choice"
            ? "probability"
            : question?.type === "score"
              ? "score"
              : "noul",
        op: "gte",
        value: 0.85,
      },
      then: "end",
      else: "end",
    };
  if (type === "document_preview")
    return { ...base, backend: "local:npu", filename: "document.txt", text };
  if (type === "document_save")
    return { ...base, preview_id: { $step: preview?.id ?? "", path: ["preview_id"] } };
  if (type === "browser")
    return { ...base, recipe: "google_search", query: input ? text : "rahmanef.com" };
  return { ...base, backend: "local:npu" };
}

export function stepDependents(steps: WorkflowStep[], id: string): string[] {
  // `seen` makes the walk terminate on a self-referencing object. Parsed JSON is a tree, but
  // this is exported and callers build steps in memory; a cycle used to throw RangeError.
  // `depth` caps the walk: `parseWorkflow` accepts JSON nested past 5 000 levels, which the
  // recursive scan turned into "Maximum call stack size exceeded" on the canvas. Nothing at
  // that depth is a live `$step` reference, so stopping is a refusal, not a lost edge.
  const seen = new WeakSet<object>();
  const MAX_DEPTH = 64;
  function refers(value: any, depth = 0): boolean {
    if (depth > MAX_DEPTH) return false;
    if (Array.isArray(value)) return value.some((item) => refers(item, depth + 1));
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (value.$step === id || value.step === id) return true;
    return Object.values(value).some((item) => refers(item, depth + 1));
  }
  return steps
    .filter((step) => step.id !== id && (step.then === id || step.else === id || refers(step)))
    .map((step) => step.id);
}
