<script lang="ts">
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  type Props = { backend?: string; backends?: any[] };
  let { backend = "", backends = [] }: Props = $props();
  let selected = $derived(backends.find((item) => item.id === backend));
  const TASKS = [
    {
      title: "Try a decision",
      detail:
        "Check a guardrail, route a message or evaluate an invoice policy. The answer shows the model's label and probability before you connect it to an action.",
      section: "playground",
      action: "Open decision simulation",
      icon: "play",
    },
    {
      title: "Review an action before it runs",
      detail:
        "Organise text documents. The document recipe previews the exact folder and byte count, and saves a copy only after you approve it.",
      section: "apps",
      action: "Open automation",
      icon: "workflow",
    },
    {
      title: "Ask in plain text",
      detail:
        "The chat in this workspace keeps drafts and saves chats per tab. It needs a configured provider before it can answer.",
      section: "chat",
      action: "Open chat",
      icon: "message",
    },
    {
      title: "Turn speech into a decision",
      detail:
        "Transcribe a recording, then classify the transcript and follow a routing policy. Needs a speech model and a decision model.",
      section: "voice",
      action: "Open voice to action",
      icon: "mic",
    },
  ];
</script>

<View
  title="Start with a decision"
  icon="sparkles"
  subtitle="Four screens for decisions, automation, chat and speech. This browser build has no runtime and no model, so each one reports what is not configured instead of answering; the desktop app runs them on its own NPU, GPU or CPU."
>
  {#snippet actions()}<a class="btn" href="#setup">Check my setup</a>{/snippet}
  <section class="welcome-status" aria-label="Device readiness">
    <div class="flex items-center gap-3">
      <span class="status-symbol"><Icon name="cpu" size={22} /></span>
      <div>
        <h2>
          {#if selected?.stub}
            No compute device is configured
          {:else if selected?.ready}
            {selected.kind === "local"
              ? `${selected.device} selected for local decisions`
              : `${selected.device} endpoint selected`}
          {:else}
            Choose a ready compute device
          {/if}
        </h2>
        <p>
          {#if selected?.stub}
            Every request in this build is answered by a fixed stub. <a
              class="text-link"
              href="#setup">Setup check</a
            > reports the server, the model and the NPU driver as not configured, which is the
            accurate state.
          {:else if selected?.ready}
            {selected.kind === "local"
              ? "Decision inference stays on this machine. Every result shows which device ran."
              : "This selection sends decision requests to your configured endpoint. Choose a local device for local inference."}
          {:else}
            Open Setup check to see detected devices and the next step.
          {/if}
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
      <h2>See how a decision works</h2>
      <p>
        A decision model reads a short state and returns a label, a score or a probability. Your
        rules turn that answer into an action, so a wrong label costs you an action you did not
        approve.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <a class="btn" href="#playground">Open decision simulation</a><a class="btn" href="#snake"
        >Open the Snake demo</a
      ><a class="btn" href="#transcribe">Open Transcribe</a>
    </div>
  </section>
  <details class="overview-details">
    <summary>What each model is, and what it cannot do</summary>
    <dl>
      <div>
        <dt>Decision model</dt>
        <dd>
          A small classifier for English text with a 256-token input window. It returns a label or
          a probability and never writes prose. This build ships no checkpoint, so the screen
          reports no model instead of inventing an answer.
        </dd>
      </div>
      <div>
        <dt>Speech model</dt>
        <dd>
          Local speech recognition over a recording. In the desktop app audio and transcript stay
          on the device when local compute is selected. This build cannot load one.
        </dd>
      </div>
      <div>
        <dt>Chat model</dt>
        <dd>
          A separate generative model for the chat. The desktop app shows the device and the
          measured output speed for each reply; this build has no model to load.
        </dd>
      </div>
      <div>
        <dt>Measurements</dt>
        <dd>
          This build ships no saved measurements and has no benchmark screen. The one timing it can
          report is the Playground round trip, which the browser measures itself: open <a
            class="text-link"
            href="#playground">Decision simulation</a
          > and run an example.
        </dd>
      </div>
    </dl>
  </details>
</View>
