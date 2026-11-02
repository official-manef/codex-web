<script lang="ts">
  import { onMount } from "svelte";
  import { Icon } from "../../shared/icons/index.js";
  import AttachmentPreview from "#lib/AttachmentPreview.svelte";
  import PanelResizeHandle from "#lib/PanelResizeHandle.svelte";
  import { api } from "#lib/http.js";
  import { readDraft, saveDraft } from "#lib/drafts.js";
  import {
    parseWorkflow,
    flowEdges,
    newStep,
    stepDependents,
    type WorkflowStep,
  } from "#lib/workflow_graph.js";
  let {
    specText = $bindable(""),
    inputsText = $bindable("{}"),
    catalogue,
    run = null,
    disabled = false,
    onedit = () => {},
  }: {
    specText: string;
    inputsText: string;
    catalogue: any;
    run?: any;
    disabled?: boolean;
    onedit?: () => void;
  } = $props();
  let spec = $derived(parseWorkflow(specText));
  let selectedId = $state("");
  let selected = $derived(spec?.steps.find((step) => step.id === selectedId));
  let selectedIndex = $derived(spec?.steps.findIndex((step) => step.id === selectedId) ?? -1);
  let positions = $state<Record<string, { x: number; y: number }>>({});
  let scale = $state(0.85);
  let adding = $state(false);
  let message = $state("");
  let nodeJson = $state("");
  let ready = $state(false);
  let workspaceWidth = $state(0);
  let inspectorWidth = $state(290);
  let inspectorMax = $derived(Math.min(400, Math.max(200, workspaceWidth - 308)));
  let splitInspector = $derived(workspaceWidth >= 508);
  let uploading = $state(false);
  let imagePicker = $state<HTMLInputElement>();
  let provider = $derived(
    catalogue?.providers?.find((item: any) => item.provider_ref === "configured"),
  );
  let sourceQuestion = $derived(
    spec?.steps.find((step) => step.id === selected?.condition?.step)?.questions?.[
      selected?.condition?.question
    ],
  );
  let branchFields = $derived(
    sourceQuestion?.type === "choice"
      ? ["probability", "choice"]
      : sourceQuestion?.type === "score"
        ? ["score", "confidence"]
        : ["noul"],
  );
  let branchOperators = $derived(
    selected?.condition?.field === "choice" ? ["eq", "ne"] : ["gte", "gt", "lte", "lt", "eq", "ne"],
  );
  const TYPES: Record<string, { title: string; icon: string; hint: string }> = {
    perceive: { title: "Ask AI", icon: "sparkles", hint: "Read text or a supported image" },
    branch: { title: "If / else", icon: "fork", hint: "Apply your rule to an AI answer" },
    document_preview: { title: "Preview document", icon: "folder", hint: "Prepare a document" },
    document_save: { title: "Save document", icon: "check", hint: "Save after your approval" },
    browser: { title: "Search browser", icon: "search", hint: "Search Google after approval" },
    windows_hint: { title: "Windows Solitaire", icon: "grid", hint: "Request one real app hint" },
  };
  let inputs = $derived.by(() => {
    try {
      return JSON.parse(inputsText);
    } catch {
      return null;
    }
  });
  let width = $derived(
    Math.max(760, ...(spec?.steps ?? []).map((step, index) => point(step.id, index).x + 420)),
  );
  let height = $derived(
    Math.max(360, ...(spec?.steps ?? []).map((step, index) => point(step.id, index).y + 230)),
  );
  let edges = $derived(flowEdges(spec?.steps ?? []));
  onMount(() => {
    const saved = readDraft<any>("workflow-canvas", null);
    if (saved?.positions && typeof saved.positions === "object") {
      positions = Object.fromEntries(
        Object.entries(saved.positions).filter(
          ([, value]: any) =>
            value &&
            Number.isFinite(value.x) &&
            Number.isFinite(value.y) &&
            value.x >= 20 &&
            value.x <= 8000 &&
            value.y >= 30 &&
            value.y <= 2000,
        ),
      ) as Record<string, { x: number; y: number }>;
    }
    if (Number.isFinite(saved?.scale)) scale = Math.min(1.25, Math.max(0.5, saved.scale));
    if (Number.isFinite(saved?.inspectorWidth))
      inspectorWidth = Math.min(400, Math.max(200, saved.inspectorWidth));
    ready = true;
  });
  $effect(() => {
    if (ready) saveDraft("workflow-canvas", { positions, scale, inspectorWidth });
  });
  $effect(() => {
    nodeJson = selected ? JSON.stringify(selected, null, 2) : "";
  });
  function point(id: string, index: number) {
    return positions[id] ?? { x: 40 + index * 260, y: 100 };
  }
  function write(value: any) {
    specText = JSON.stringify(value, null, 2);
    message = "";
    onedit();
  }
  function patch(changes: Record<string, any>) {
    if (!spec || !selected || disabled) return;
    write({
      ...spec,
      steps: spec.steps.map((step) => (step.id === selectedId ? { ...step, ...changes } : step)),
    });
  }
  function condition(changes: Record<string, any>) {
    patch({ condition: { ...selected?.condition, ...changes } });
  }
  function setBackend(backend: string) {
    if (!spec || !selected || disabled) return;
    if (backend !== "byok" && Object.keys(selected.assets ?? {}).length) {
      message = "Remove image attachments before choosing a local text-only model.";
      return;
    }
    const step: WorkflowStep = { ...selected, backend };
    if (backend === "byok") step.provider_ref = "configured";
    else delete step.provider_ref;
    write({ ...spec, steps: spec.steps.map((item) => (item.id === selectedId ? step : item)) });
  }
  function chooseQuestion(stepId: string, questionId?: string) {
    const source = spec?.steps.find((step) => step.id === stepId);
    const id = questionId ?? Object.keys(source?.questions ?? {})[0] ?? "";
    const question = source?.questions?.[id];
    condition({
      step: stepId,
      question: id,
      field:
        question?.type === "choice" ? "probability" : question?.type === "score" ? "score" : "noul",
      op: "gte",
      value: 0.85,
    });
  }
  function question(id: string, changes: Record<string, any>) {
    patch({
      questions: { ...selected?.questions, [id]: { ...selected?.questions[id], ...changes } },
    });
  }
  function changeQuestionType(id: string, type: string) {
    const current = selected?.questions[id];
    if (!current) return;
    const next = { ...current, type };
    delete next.criteria;
    if (type === "choice")
      next.criteria = {
        request: "The message asks for help",
        other: "The message is about another subject",
      };
    if (type === "score")
      next.criteria = [
        "The issue causes a minor inconvenience",
        "The issue prevents the user from working",
      ];
    patch({ questions: { ...selected?.questions, [id]: next } });
  }
  function addQuestion() {
    let index = 1;
    while (selected?.questions?.[`question_${index}`]) index++;
    question(`question_${index}`, { type: "noul", instructions: "Does `message` ask for help?" });
  }
  function add(type: string) {
    if (!spec || disabled) return;
    const step = newStep(type, spec.steps, spec.inputs);
    write({ ...spec, steps: [...spec.steps, step] });
    selectedId = step.id;
    adding = false;
    if (spec.steps.at(-1)?.type === "branch")
      message = "Choose the earlier If / else step and connect Yes or No to this new step.";
  }
  function remove() {
    if (!spec || !selected || disabled) return;
    const dependents = stepDependents(spec.steps, selected.id);
    if (dependents.length) {
      message = `Update the connections in ${dependents.join(", ")} before deleting this node.`;
      return;
    }
    if (spec.steps.length <= 1) {
      message = "Keep at least one step, or load another starter.";
      return;
    }
    write({ ...spec, steps: spec.steps.filter((step) => step.id !== selectedId) });
    selectedId = "";
  }
  function move(offset: number) {
    if (!spec || !selected || disabled) return;
    const steps = [...spec.steps];
    const index = selectedIndex + offset;
    if (index < 0 || index >= steps.length) return;
    [steps[index], steps[selectedIndex]] = [steps[selectedIndex], steps[index]];
    positions = {};
    write({ ...spec, steps });
    message = "Order changed. Check the workflow to verify references and branches.";
  }
  function drag(event: PointerEvent, id: string, index: number) {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    const start = point(id, index);
    const x = event.clientX,
      y = event.clientY;
    target.setPointerCapture(event.pointerId);
    const moving = (e: PointerEvent) => {
      positions = {
        ...positions,
        [id]: {
          x: Math.min(8000, Math.max(20, start.x + (e.clientX - x) / scale)),
          y: Math.min(2000, Math.max(30, start.y + (e.clientY - y) / scale)),
        },
      };
    };
    const stop = () => {
      target.removeEventListener("pointermove", moving);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", moving);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  }
  function nudge(event: KeyboardEvent, id: string, index: number) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const p = point(id, index);
    positions = {
      ...positions,
      [id]: {
        x: Math.min(
          8000,
          Math.max(
            20,
            p.x + (event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0),
          ),
        ),
        y: Math.min(
          2000,
          Math.max(30, p.y + (event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0)),
        ),
      },
    };
  }
  function edgePath(from: string, to: string, label: string) {
    const list = spec?.steps ?? [];
    const a = point(
      from,
      list.findIndex((step) => step.id === from),
    );
    const b =
      to === "end"
        ? { x: width - 110, y: 100 }
        : point(
            to,
            list.findIndex((step) => step.id === to),
          );
    const x1 = a.x + 196,
      y1 = a.y + (label === "No" ? 84 : 57),
      x2 = b.x,
      y2 = b.y + 57;
    const distance = Math.max(36, Math.abs(x2 - x1) / 2);
    const lift = label === "No" ? 95 : 0;
    return `M${x1},${y1} C${x1 + distance},${y1 + lift} ${x2 - distance},${y2 + lift} ${x2},${y2}`;
  }
  function setInput(key: string, value: any) {
    inputsText = JSON.stringify({ ...(inputs ?? {}), [key]: value }, null, 2);
    onedit();
  }
  function setState(key: string, value: any) {
    if (typeof selected?.state === "string") patch({ state: value });
    else patch({ state: { ...selected?.state, [key]: value } });
  }
  async function uploadImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !selected || disabled || uploading) return;
    const id = selected.id;
    uploading = true;
    message = "";
    try {
      if (
        !["image/png", "image/jpeg"].includes(file.type) ||
        file.size > (provider?.image_limits?.max_image_bytes ?? 0)
      )
        throw new Error("Choose a PNG or JPEG within the provider's image limit.");
      const attachment = await api.attachmentUpload(file);
      if (attachment.error) throw new Error(attachment.error);
      if (disabled || selectedId !== id || selected?.backend !== "byok") return;
      let n = 1;
      while (selected.assets?.[`image_asset_${n}`]) n++;
      const key = `image_asset_${n}`;
      const state = typeof selected.state === "object" ? selected.state : { text: selected.state };
      patch({
        state: { ...state, [key]: key },
        assets: { ...selected.assets, [key]: { attachment_id: attachment.id } },
      });
      message = `Image added as ${key}. Refer to that name in your question. It stays local until you approve sending it.`;
    } catch (e) {
      message = e instanceof Error ? e.message : "The image could not be attached. Try again.";
    } finally {
      uploading = false;
    }
  }
  function detachImage(key: string) {
    const assets = { ...selected?.assets };
    delete assets[key];
    const state = { ...selected?.state };
    if (state[key] === key) delete state[key];
    patch({ assets, state });
  }
  function valueField(key: string, value: any) {
    const inputKey = value?.$input;
    return inputKey
      ? `Input: ${inputKey}`
      : typeof value === "string"
        ? value
        : `${key} from another step`;
  }
</script>

{#if spec}
  <div class="canvas-tools">
    <label class="workflow-name"
      ><span class="sr-only">Workflow name</span><input
        class="field"
        value={spec.name ?? ""}
        maxlength="80"
        {disabled}
        oninput={(e) => write({ ...spec, name: e.currentTarget.value })}
        placeholder="Name your workflow"
      /></label
    >
    <span class="node-count">{spec.steps.length} steps</span>
    <button
      class="btn"
      onclick={() => (adding = !adding)}
      disabled={disabled || spec.steps.length >= (catalogue?.limits?.max_steps ?? 0)}
      ><Icon name="plus" /> Add step</button
    >
    <div class="zoom-controls" aria-label="Canvas zoom">
      <button
        class="btn"
        aria-label="Zoom out"
        disabled={scale <= 0.5}
        onclick={() => (scale = Math.max(0.5, scale - 0.1))}>−</button
      ><span>{Math.round(scale * 100)}%</span><button
        class="btn"
        aria-label="Zoom in"
        disabled={scale >= 1.25}
        onclick={() => (scale = Math.min(1.25, scale + 0.1))}>+</button
      ><button
        class="btn"
        onclick={() => {
          positions = {};
          scale = 0.85;
        }}>Arrange</button
      >
    </div>
  </div>
  {#if adding}<div class="node-palette" aria-label="Add a workflow step">
      {#each catalogue?.step_types ?? [] as entry}{@const type = TYPES[entry.type]}<button
          class="palette-item"
          onclick={() => add(entry.type)}
          {disabled}
          ><Icon name={type?.icon ?? "code"} size={18} /><span
            ><strong>{type?.title ?? entry.type}</strong><small>{type?.hint ?? entry.type}</small
            ></span
          ></button
        >{/each}
    </div>{/if}
  <div
    class="flow-workspace"
    class:has-selection={!!selected}
    class:stacked-inspector={!splitInspector}
    bind:clientWidth={workspaceWidth}
    style:--step-editor-width={`${Math.min(inspectorWidth, inspectorMax)}px`}
  >
    <div
      class="flow-scroll"
      role="region"
      aria-label="Workflow canvas. Scroll to explore. Select a node to edit it."
    >
      <div
        class="flow-size"
        style:width={`${width * scale}px`}
        style:height={`${height * scale}px`}
      >
        <div
          class="flow-stage"
          style:width={`${width}px`}
          style:height={`${height}px`}
          style:transform={`scale(${scale})`}
        >
          <svg class="flow-wires" {width} {height} aria-hidden="true"
            ><defs
              ><marker
                id="workflow-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" /></marker
              ></defs
            >{#each edges as edge}<path
                d={edgePath(edge.from, edge.to, edge.label)}
                marker-end="url(#workflow-arrow)"
                class:negative={edge.label === "No"}
              />{/each}</svg
          >
          {#each spec.steps as step, index (step.id)}
            {@const p = point(step.id, index)}{@const type = TYPES[step.type]}{@const result =
              run?.steps?.find((item: any) => item.id === step.id)}
            <div
              class="flow-node"
              class:selected={selectedId === step.id}
              class:finished={result?.state === "completed"}
              class:failed={result?.state === "failed"}
              style:left={`${p.x}px`}
              style:top={`${p.y}px`}
            >
              <button
                class="node-grip"
                aria-label={`Move ${step.label ?? step.id}. Arrow keys move the node.`}
                onpointerdown={(e) => drag(e, step.id, index)}
                onkeydown={(e) => nudge(e, step.id, index)}><span></span></button
              >
              <button
                class="node-content"
                aria-pressed={selectedId === step.id}
                onclick={() => {
                  selectedId = step.id;
                  message = "";
                }}
              >
                <span class="node-heading"
                  ><Icon name={type?.icon ?? "code"} size={22} /><strong
                    >{step.label || type?.title || step.type}</strong
                  ></span
                >
                <span class="node-detail"
                  >{step.type === "branch"
                    ? `${step.condition?.question ?? "Answer"} ${step.condition?.op ?? ""} ${step.condition?.value ?? ""}`
                    : step.backend === "byok"
                      ? "External model · approval"
                      : (step.backend?.replace("local:", "").toUpperCase() ??
                        (step.type === "browser" || step.type === "document_save"
                          ? "Approval required"
                          : step.id))}</span
                >
                {#if result}<span class="node-state">{result.state.replaceAll("_", " ")}</span>{/if}
              </button>
              <span class="port port-in" aria-hidden="true"></span><span
                class="port port-out"
                aria-hidden="true"
              ></span>
              {#if step.type === "branch"}<span class="branch-yes">Yes</span><span class="branch-no"
                  >No</span
                ><span class="port port-no" aria-hidden="true"></span>{/if}
            </div>
          {/each}
          <div class="flow-end" style:left={`${width - 110}px`} style:top="140px">
            <Icon name="check" size={16} /> End
          </div>
        </div>
      </div>
      <p class="canvas-hint">Select a step to edit. Drag its top handle to arrange.</p>
    </div>
    {#if selected}{#if splitInspector}<PanelResizeHandle
          bind:value={inspectorWidth}
          min={200}
          max={inspectorMax}
          label="Step editor width"
        />{/if}
      <aside class="node-inspector" aria-label="Edit selected step">
        <div class="inspector-title">
          <h3>{TYPES[selected.type]?.title ?? selected.type}</h3>
          <button class="btn" aria-label="Close step editor" onclick={() => (selectedId = "")}
            ><Icon name="x" /></button
          >
        </div>
        <label
          >Step name<input
            class="field"
            value={selected.label ?? ""}
            placeholder={selected.id}
            {disabled}
            maxlength="100"
            oninput={(e) => patch({ label: e.currentTarget.value || selected.id })}
          /></label
        >
        {#if selected.backend}<label
            >Model / device<select
              class="field"
              value={selected.backend}
              {disabled}
              onchange={(e) => setBackend(e.currentTarget.value)}
              >{#each (catalogue?.backends ?? []).filter((id: string) => selected?.type === "perceive" || id !== "byok") as id}<option
                  value={id}
                  >{id === "byok"
                    ? "BYOK · external model"
                    : id.replace("local:", "").toUpperCase()}</option
                >{/each}</select
            ></label
          >{/if}
        {#if selected.type === "perceive"}
          {#if selected.backend === "byok"}<p class="inspector-note">
              Review the exact data before it leaves your device. <a
                class="text-link"
                href="#backends">Connect provider</a
              >
            </p>
            <p class="inspector-note">
              {provider?.vision_label ?? "Image support unverified"}
            </p>{:else}<p class="inspector-note">English text · no image understanding.</p>{/if}
          {#each typeof selected.state === "string" ? [["text", selected.state]] : Object.entries(selected.state ?? {}) as [key, value]}
            {#if typeof value === "string" || (value && typeof value === "object" && "$input" in value)}
              <label
                >{key}<select
                  class="field"
                  value={typeof value === "object" ? `input:${value.$input}` : "text"}
                  {disabled}
                  onchange={(e) =>
                    setState(
                      String(key),
                      e.currentTarget.value === "text"
                        ? ""
                        : { $input: e.currentTarget.value.slice(6) },
                    )}
                  ><option value="text">Write text</option
                  >{#each Object.entries(spec.inputs ?? {}).filter(([, input]: any) => input.type === "string") as [name]}<option
                      value={`input:${name}`}>Input: {name}</option
                    >{/each}</select
                ></label
              >
              {#if typeof value === "string"}<label
                  ><span class="sr-only">{key} text</span><textarea
                    class="field"
                    rows="3"
                    {value}
                    {disabled}
                    oninput={(e) => setState(String(key), e.currentTarget.value)}></textarea></label
                >{/if}
            {/if}
          {/each}
          {#if selected.backend === "byok"}
            {#each Object.entries(selected.assets ?? {}) as [key, image]}
              {@const asset = image as any}
              <div class="image-asset">
                <span>{key}</span>{#if typeof asset.attachment_id === "string"}<AttachmentPreview
                    file={{ id: asset.attachment_id, name: key, kind: "image" }}
                    compact
                  />{:else}<small>Uses a workflow input</small>{/if}<button
                  class="btn"
                  {disabled}
                  onclick={() => detachImage(key)}>Remove image</button
                >
              </div>
            {/each}
            <input
              type="file"
              class="sr-only"
              accept="image/png,image/jpeg"
              bind:this={imagePicker}
              onchange={uploadImage}
            />
            <button
              class="btn"
              disabled={disabled ||
                uploading ||
                provider?.vision !== true ||
                Object.keys(selected.assets ?? {}).length >=
                  (provider?.image_limits?.max_images ?? 0)}
              onclick={() => imagePicker?.click()}
              ><Icon name="plus" />{uploading ? "Adding image…" : "Add image"}</button
            >
            {#if provider?.vision === true}<p class="inspector-note">
                PNG/JPEG · {provider.image_limits.image_min_side}–{provider.image_limits
                  .image_max_side} px per side · up to {(
                  provider.image_limits.max_image_bytes /
                  1024 /
                  1024
                ).toFixed(0)} MiB.
              </p>{/if}
          {/if}
          {#each Object.entries(selected.questions ?? {}) as [id, q]}
            {@const item = q as any}
            <fieldset class="question-fields">
              <legend>{id}</legend><label
                >Answer type<select
                  class="field"
                  value={item.type}
                  {disabled}
                  onchange={(e) => changeQuestionType(id, e.currentTarget.value)}
                  ><option value="noul">Yes / no probability</option><option value="choice"
                    >Choose one option</option
                  ><option value="score">Score</option></select
                ></label
              ><label
                >Question<textarea
                  class="field"
                  rows="3"
                  value={item.instructions ?? ""}
                  {disabled}
                  oninput={(e) => question(id, { instructions: e.currentTarget.value })}
                ></textarea></label
              >
              {#if item.type === "choice"}{#each Object.entries(item.criteria ?? {}) as [option, description]}<label
                    >{option}<input
                      class="field"
                      value={String(description)}
                      {disabled}
                      oninput={(e) =>
                        question(id, {
                          criteria: { ...item.criteria, [option]: e.currentTarget.value },
                        })}
                    /></label
                  >{/each}{:else if item.type === "score"}{#each Array.isArray(item.criteria) ? item.criteria : [] as level, index}<label
                    >Level {index}<input
                      class="field"
                      value={level}
                      {disabled}
                      oninput={(e) =>
                        question(id, {
                          criteria: item.criteria.map((text: string, i: number) =>
                            i === index ? e.currentTarget.value : text,
                          ),
                        })}
                    /></label
                  >{/each}{/if}
            </fieldset>
          {/each}
          <button
            class="btn"
            onclick={addQuestion}
            disabled={disabled ||
              Object.keys(selected.questions ?? {}).length >=
                (catalogue?.limits?.max_questions_per_step ?? 0)}
            ><Icon name="plus" /> Question</button
          >
        {:else if selected.type === "branch"}
          <label
            >Answer from<select
              class="field"
              value={selected.condition?.step ?? ""}
              {disabled}
              onchange={(e) => chooseQuestion(e.currentTarget.value)}
              ><option value="" disabled>Choose an earlier AI step</option>{#each spec.steps
                .slice(0, selectedIndex)
                .filter((step) => step.type === "perceive") as source}<option value={source.id}
                  >{source.label ?? source.id}</option
                >{/each}</select
            ></label
          >
          <label
            >Question<select
              class="field"
              value={selected.condition?.question ?? ""}
              {disabled}
              onchange={(e) => chooseQuestion(selected.condition?.step, e.currentTarget.value)}
              >{#each Object.keys(spec.steps.find((step) => step.id === selected?.condition?.step)?.questions ?? {}) as id}<option
                  value={id}>{id}</option
                >{/each}</select
            ></label
          >
          <div class="condition-row">
            <label
              >Value<select
                class="field"
                value={selected.condition?.field ?? "noul"}
                {disabled}
                onchange={(e) =>
                  condition({
                    field: e.currentTarget.value,
                    ...(e.currentTarget.value === "choice"
                      ? { op: "eq", value: Object.keys(sourceQuestion?.criteria ?? {})[0] ?? "" }
                      : { op: "gte", value: 0.85 }),
                  })}
                >{#each branchFields as field}<option value={field}>{field}</option>{/each}</select
              ></label
            ><label
              >Rule<select
                class="field"
                value={selected.condition?.op ?? "gte"}
                {disabled}
                onchange={(e) => condition({ op: e.currentTarget.value })}
                >{#each branchOperators as op}<option value={op}
                    >{{ gte: "≥", gt: ">", lte: "≤", lt: "<", eq: "=", ne: "≠" }[op]}</option
                  >{/each}</select
              ></label
            >
          </div>
          <label
            >Threshold / option<input
              class="field"
              value={selected.condition?.value ?? ""}
              {disabled}
              oninput={(e) =>
                condition({
                  value:
                    selected?.condition?.field === "choice"
                      ? e.currentTarget.value
                      : Number(e.currentTarget.value),
                })}
            /></label
          >
          {#each ["then", "else"] as key}<label
              >{key === "then" ? "Yes →" : "No →"}<select
                class="field"
                value={selected[key]}
                {disabled}
                onchange={(e) => patch({ [key]: e.currentTarget.value })}
                ><option value="end">End workflow</option
                >{#each spec.steps.slice(selectedIndex + 1) as target}<option value={target.id}
                    >{target.label ?? target.id}</option
                  >{/each}</select
              ></label
            >{/each}
        {:else if selected.type === "browser"}<label
            >Search for<input
              class="field"
              value={typeof selected.query === "string" ? selected.query : ""}
              placeholder={valueField("Query", selected.query)}
              disabled={disabled || typeof selected.query !== "string"}
              oninput={(e) => patch({ query: e.currentTarget.value })}
            /></label
          >
        {:else if selected.type === "document_preview"}<label
            >File name<input
              class="field"
              value={typeof selected.filename === "string" ? selected.filename : ""}
              disabled={disabled || typeof selected.filename !== "string"}
              oninput={(e) => patch({ filename: e.currentTarget.value })}
            /></label
          >
          <p class="inspector-note">{valueField("Text", selected.text)}</p>
        {:else if selected.type === "document_save"}<p class="inspector-note">
            Uses the document preview from {selected.preview_id?.$step ?? "an earlier step"}. You
            approve the destination before saving.
          </p>
        {:else if selected.type === "windows_hint"}<p class="inspector-note">
            Reads the current Windows Solitaire window. You approve one Hint action; your game is
            preserved.
          </p>{/if}
        <details>
          <summary>Advanced step settings</summary><label
            >Complete node JSON<textarea
              class="field mono"
              rows="12"
              bind:value={nodeJson}
              {disabled}
              spellcheck="false"></textarea></label
          ><button
            class="btn"
            {disabled}
            onclick={() => {
              try {
                const value = JSON.parse(nodeJson);
                if (value.id !== selectedId || value.type !== selected?.type)
                  throw new Error(
                    "Keep this node's ID and type. Use the full JSON editor to rename IDs.",
                  );
                patch(value);
              } catch (e) {
                message = e instanceof Error ? e.message : "Correct the node JSON.";
              }
            }}>Apply node settings</button
          >
        </details>
        <div class="node-order">
          <button class="btn" disabled={disabled || selectedIndex <= 0} onclick={() => move(-1)}
            >Earlier</button
          ><button
            class="btn"
            disabled={disabled || selectedIndex >= spec.steps.length - 1}
            onclick={() => move(1)}>Later</button
          ><button class="btn" {disabled} onclick={remove}>Delete step</button>
        </div>
        {#if message}<p class="inspector-note" role="status">{message}</p>{/if}
      </aside>{/if}
  </div>
  {#if Object.keys(spec.inputs ?? {}).length}<section
      class="flow-inputs"
      aria-label="Workflow inputs"
    >
      <h3>Run inputs</h3>
      {#if !inputs || typeof inputs !== "object" || Array.isArray(inputs)}<p>
          Correct the run inputs in Advanced → JSON.
        </p>{:else}{#each Object.entries(spec.inputs ?? {}) as [key, value]}{@const field =
            value as any}<label
            >{field.label ?? key}{#if field.enum}<select
                class="field"
                value={JSON.stringify(inputs[key] ?? field.default)}
                {disabled}
                onchange={(e) => setInput(key, JSON.parse(e.currentTarget.value))}
                >{#each field.enum as option}<option value={JSON.stringify(option)}
                    >{String(option)}</option
                  >{/each}</select
              >{:else if field.type === "boolean"}<select
                class="field"
                value={String(inputs[key] ?? field.default ?? false)}
                {disabled}
                onchange={(e) => setInput(key, e.currentTarget.value === "true")}
                ><option value="true">Yes</option><option value="false">No</option></select
              >{:else if field.type === "number"}<input
                class="field"
                type="number"
                value={inputs[key] ?? field.default ?? ""}
                {disabled}
                oninput={(e) =>
                  setInput(
                    key,
                    e.currentTarget.value === "" ? undefined : e.currentTarget.valueAsNumber,
                  )}
              />{:else}<textarea
                class="field"
                rows="2"
                value={inputs[key] ?? field.default ?? ""}
                maxlength={field.max_length ?? catalogue?.limits?.max_input_chars}
                {disabled}
                oninput={(e) => setInput(key, e.currentTarget.value)}></textarea>{/if}</label
          >{/each}{/if}
    </section>{/if}
{:else}<div class="canvas-empty">
    <Icon name="workflow" size={32} />
    <h3>{specText ? "This draft needs a small correction" : "Start with a workflow"}</h3>
    <p>
      {specText
        ? "Open Advanced → JSON to correct the definition, or choose a starter."
        : "Choose a starter above, then select a node to make it yours."}
    </p>
  </div>{/if}

<style>
  .canvas-tools,
  .zoom-controls,
  .inspector-title,
  .node-order,
  .condition-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .canvas-tools {
    flex-wrap: wrap;
    padding: 12px 0;
  }
  .workflow-name {
    flex: 1;
    min-width: 180px;
  }
  .workflow-name input {
    font-size: 16px;
    font-weight: 600;
    background: transparent;
    border-color: transparent;
  }
  .workflow-name input:hover,
  .workflow-name input:focus {
    border-color: var(--color-line);
  }
  .node-count,
  .zoom-controls span {
    font-size: 11px;
    color: var(--color-ink-2);
    font-variant-numeric: tabular-nums;
  }
  .zoom-controls {
    margin-left: auto;
  }
  .zoom-controls .btn {
    padding: 5px 8px;
  }
  .node-palette {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 4px;
    padding: 10px 0 16px;
  }
  .palette-item {
    display: flex;
    gap: 12px;
    text-align: left;
    align-items: center;
    padding: 12px;
    border-radius: 8px;
  }
  .palette-item:hover {
    background: var(--color-hover);
  }
  .palette-item strong,
  .palette-item small {
    display: block;
  }
  .palette-item small {
    color: var(--color-ink-2);
    font-size: 11px;
    margin-top: 3px;
  }
  .flow-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    overflow: hidden;
  }
  .flow-workspace.has-selection {
    grid-template-columns: minmax(300px, 1fr) 8px var(--step-editor-width, 290px);
  }
  .flow-workspace.has-selection.stacked-inspector {
    grid-template-columns: minmax(0, 1fr);
  }
  .stacked-inspector .node-inspector {
    border-left: 0;
    border-top: 1px solid var(--color-line);
    max-height: none;
  }
  .flow-scroll {
    position: relative;
    overflow: auto;
    min-height: 360px;
    max-height: 620px;
    background-color: var(--color-page);
    background-image: radial-gradient(var(--color-line) 1px, transparent 1px);
    background-size: 20px 20px;
  }
  .flow-size {
    position: relative;
    min-width: 100%;
  }
  .flow-stage {
    position: relative;
    transform-origin: top left;
  }
  .flow-wires {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .flow-wires > path {
    fill: none;
    stroke: var(--color-ink-2);
    stroke-width: 1.5;
  }
  .flow-wires marker path {
    fill: var(--color-ink-2);
  }
  .flow-wires .negative {
    stroke-dasharray: 5 4;
  }
  .flow-node {
    position: absolute;
    width: 196px;
    min-height: 114px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-panel);
  }
  .flow-node.selected {
    outline: 2px solid var(--color-ink);
    outline-offset: 3px;
  }
  .flow-node.finished .node-state {
    color: var(--color-ink);
  }
  .flow-node.failed .node-state {
    color: var(--color-destructive, #e78585);
  }
  .node-grip {
    display: grid;
    place-items: center;
    width: 100%;
    height: 18px;
    cursor: grab;
    touch-action: none;
    border-radius: 12px 12px 0 0;
  }
  .node-grip:active {
    cursor: grabbing;
  }
  .node-grip span {
    width: 24px;
    height: 3px;
    border-radius: 2px;
    background: var(--color-line);
  }
  .node-content {
    width: 100%;
    text-align: left;
    padding: 6px 16px 17px;
  }
  .node-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 30px;
  }
  .node-heading strong {
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .node-detail,
  .node-state {
    display: block;
    color: var(--color-ink-2);
    font-size: 11px;
    margin-top: 7px;
    overflow-wrap: anywhere;
  }
  .port {
    position: absolute;
    width: 9px;
    height: 9px;
    background: var(--color-ink-2);
    border-radius: 50%;
    top: 53px;
  }
  .port-in {
    left: -5px;
  }
  .port-out,
  .port-no {
    right: -5px;
  }
  .port-no {
    top: 80px;
  }
  .branch-yes,
  .branch-no {
    position: absolute;
    right: 9px;
    top: 45px;
    font-size: 10px;
    color: var(--color-ink-2);
    background: var(--color-panel);
  }
  .branch-no {
    top: 75px;
  }
  .flow-end {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  .canvas-hint {
    position: sticky;
    left: 12px;
    bottom: 10px;
    display: inline-block;
    padding: 5px 9px;
    background: var(--color-page);
    color: var(--color-ink-2);
    font-size: 11px;
    margin: 0 12px;
    border-radius: 5px;
  }
  .node-inspector {
    padding: 16px;
    max-height: 620px;
    overflow-y: auto;
  }
  .inspector-title {
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }
  label {
    display: grid;
    gap: 5px;
    font-size: 11px;
    color: var(--color-ink-2);
    margin: 12px 0;
  }
  .field {
    font-size: 12px;
    color: var(--color-ink);
  }
  .condition-row label {
    min-width: 0;
    flex: 1;
  }
  .inspector-note {
    font-size: 11px;
    color: var(--color-ink-2);
    line-height: 1.6;
    margin: 12px 0;
  }
  .question-fields {
    min-width: 0;
    padding: 0;
    border: 0;
    border-top: 1px solid var(--color-line);
    margin-top: 18px;
  }
  .question-fields legend {
    padding: 0 8px 0 0;
    font-size: 11px;
    color: var(--color-ink-2);
  }
  .node-order {
    flex-wrap: wrap;
    margin-top: 20px;
  }
  .image-asset {
    display: grid;
    gap: 8px;
    margin: 12px 0;
    padding: 12px 0;
    border-top: 1px solid var(--color-line);
    font-size: 11px;
    color: var(--color-ink-2);
  }
  .node-order .btn {
    font-size: 11px;
    padding: 5px 8px;
  }
  details {
    font-size: 11px;
    margin-top: 18px;
  }
  .flow-inputs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    column-gap: 24px;
    padding-top: 20px;
  }
  .flow-inputs h3 {
    grid-column: 1 / -1;
  }
  .flow-inputs label {
    margin-bottom: 0;
  }
  .canvas-empty {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding: 70px 20px;
    text-align: center;
    border: 1px solid var(--color-line);
    border-radius: 12px;
  }
  .canvas-empty p {
    color: var(--color-ink-2);
    font-size: 12px;
    max-width: 50ch;
  }
  @media (max-width: 850px) {
    .node-count {
      display: none;
    }
    .flow-scroll {
      min-height: 300px;
      max-height: 460px;
    }
  }
</style>
