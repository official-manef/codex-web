<script lang="ts">
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  type Props = { backend?: string; backends?: any[] };
  let { backend = "", backends = [] }: Props = $props();
  let selected = $derived(backends.find((item) => item.id === backend));
  const TASKS = [
    {
      title: "Try a decision on your device",
      detail:
        "Check a guardrail, route a message or evaluate an invoice policy. Inspect the model's answers before connecting an action.",
      section: "playground",
      action: "Open decision simulation",
      icon: "play",
    },
    {
      title: "Run an approved action",
      detail:
        "Organize text documents with Laya decisions. Preview each change before saving a copy.",
      section: "apps",
      action: "Open automations",
      icon: "workflow",
    },
    {
      title: "Chat with a local LLM",
      detail:
        "Ask questions and draft text using a separate generative model. Choose NPU, GPU or CPU explicitly.",
      section: "chat",
      action: "Open local chat",
      icon: "message",
    },
    {
      title: "Turn speech into action",
      detail:
        "Transcribe a WAV recording with Whisper, then let Laya classify it and apply the routing policy.",
      section: "voice",
      action: "Try voice to action",
      icon: "mic",
    },
  ];
</script>

<View
  title="Put your laptop's NPU to work"
  icon="sparkles"
  subtitle="Start with local AI decisions and speech. Choose NPU, GPU or CPU, inspect the result, and approve the actions you want to run."
>
  {#snippet actions()}<a class="btn" href="#setup">Check my setup</a>{/snippet}
  <section class="welcome-status" aria-label="Device readiness">
    <div class="flex items-center gap-3">
      <span class="status-symbol"><Icon name="cpu" size={22} /></span>
      <div>
        <h2>
          {selected?.ready
            ? selected.kind === "local"
              ? `${selected.device} selected for local decisions`
              : `${selected.device} endpoint selected`
            : "Choose a ready compute device"}
        </h2>
        <p>
          {selected?.ready
            ? selected.kind === "local"
              ? "Decision inference stays on this laptop. Every result shows which device ran."
              : "This selection sends decision requests to your configured external endpoint. Choose a local device for local inference."
            : "Open Setup check to see detected devices and the next step."}
        </p>
      </div>
    </div>
    <a class="btn" href="#backends">Manage devices</a>
  </section>
  <div class="task-list">
    {#each TASKS as task}<a class="task-row" href="#{task.section}"
        ><span class="task-icon"><Icon name={task.icon} size={21} /></span>
        <div>
          <h2>{task.title}</h2>
          <p>{task.detail}</p>
          <span class="task-action">{task.action} <Icon name="arrowUpRight" size={14} /></span>
        </div></a
      >{/each}
  </div>
  <section class="overview-explore">
    <div>
      <h2>See how decisions work</h2>
      <p>
        Laya reads a short state and returns a label, score or probability. Your rules turn that
        answer into an action.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <a class="btn" href="#playground">Open decision simulation</a><a class="btn" href="#snake"
        >Watch the Snake demo</a
      ><a class="btn" href="#transcribe">Transcribe audio</a>
    </div>
  </section>
  <details class="overview-details">
    <summary>Understand the models and their limits</summary>
    <dl>
      <div>
        <dt>Laya · decisions</dt>
        <dd>
          421M parameter classifier, English text, 256-token input window. It does not write chat
          replies. Your code applies the policy.
        </dd>
      </div>
      <div>
        <dt>Whisper · speech</dt>
        <dd>
          Local speech recognition from WAV recordings. Audio and transcription stay on this device
          when local compute is selected.
        </dd>
      </div>
      <div>
        <dt>Local LLM · chat</dt>
        <dd>
          A separately installed generative model writes replies. NPU generation can be slower than
          GPU; the chat shows actual device and measured speed.
        </dd>
      </div>
      <div>
        <dt>Benchmark measurements</dt>
        <dd>
          This template ships no saved measurements. Run local benchmarks on your machine to
          measure actual device latency. <a class="text-link" href="#performance">See benchmarks</a>.
        </dd>
      </div>
    </dl>
  </details>
</View>
