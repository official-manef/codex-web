<script lang="ts">
  import View from "#lib/View.svelte";
  const GROUPS: [string, [string, string][]][] = [
    [
      "This browser build",
      [
        [
          "What am I looking at?",
          "A workspace shell copied from the laya-npu desktop app and hosted in a browser. There is no local server, no model and no NPU access here: a capability screen that needs one reports itself as not configured rather than pretending, and no inference runs.",
        ],
        [
          "How do I read the rest of this page?",
          "Answers that describe Laya, Whisper, the Intel NPU, Windows RPA or model downloads describe the desktop app running on Windows. They are accurate there and unverifiable here; this build has none of those paths.",
        ],
        [
          "Where does my data go in this build?",
          "Chats, drafts, projects and layout stay in this browser’s sessionStorage and localStorage. Nothing is uploaded, and closing the tab discards the session-scoped parts.",
        ],
      ],
    ],
    [
      "Getting started",
      [
        [
          "Which task should I start with?",
          "Open Start here and choose Decision simulation, Automation, Local chat or Voice to action. Decision simulation includes sample inputs for testing rules without running actions. In the desktop app, Setup check shows the server and local device status; here it shows what is not configured.",
        ],
        [
          "What is Laya?",
          "A decision classifier: give it short English text and typed questions to get a label, score or yes/no probability. It can pick a wrong label with high confidence, so your application rules decide which action is allowed. Nothing in this browser build runs it.",
        ],
        [
          "Can I chat with it?",
          "In the desktop app, Local chat uses a separate generative LLM and replies show the device, timing and output speed actually used. This build has no model installed, so a send is answered with “No provider configured”.",
        ],
        [
          "What is Jev?",
          "Jev System One is the typed question-and-answer protocol used by the decision model. It describes a state and questions of type choice, score or noul.",
        ],
        [
          "What do choice, score and noul mean?",
          "choice selects from named options and returns their probabilities. score places input on an ordered scale. noul answers a yes/no question with P(yes). A model probability is a signal to evaluate, not proof that the answer is correct.",
        ],
      ],
    ],
    [
      "Hardware and speed · desktop app",
      [
        [
          "Does my computer have a supported NPU?",
          "In the desktop app, the NPU integration uses Intel AI Boost through OpenVINO on Windows, and Setup check inspects the devices the local server reports. Other vendors’ neural processors are not supported there. This browser build has no device access at all; its Setup check reports no server because there is none.",
        ],
        [
          "Why is my NPU missing in WSL?",
          "The desktop app runs on Windows and its NPU path needs the Windows driver; it cannot reach the NPU from WSL or a virtual machine. That is a desktop-app limit, not something this page can test — there is no device access here at all.",
        ],
        [
          "Should I install Intel’s driver or my laptop maker’s?",
          "Start with the laptop vendor’s supported driver. The desktop app’s Compute & devices screen shows the installed Intel NPU driver, an available version and a download link when appropriate; installing one needs administrator rights and a reboot. This build’s Compute & devices screen reports no driver because it has no server.",
        ],
        [
          "Is NPU always the fastest device?",
          "No. It depends on the model and workload. NPU performs well on short decision questions and speech recognition, while sequential chat generation can be faster on GPU. Device speed depends on model architecture, quantization, and driver support.",
        ],
        [
          "Why does the first request take longer?",
          "OpenVINO compiles a model for the selected device on first use. First compile time varies by device (NPU, GPU or CPU). Chat and speech have separate compile times, and cached kernels may make later starts faster.",
        ],
      ],
    ],
    [
      "Automation and inputs · desktop app",
      [
        [
          "What can Automation do on my laptop?",
          "In the desktop app, Windows RPA observes the installed Microsoft Solitaire app and uses local text perception before a fixed policy may request one Hint. It preserves your game and records actual screenshots. Browser adapters run reviewed steps without AI and wait for you when a site requires CAPTCHA or consent. The document workflow classifies text with Laya and saves a copy only after approval. Explore → Decision simulation → Invoice policy only evaluates rules; it does not contact an ERP, write files or control applications. This browser build runs none of those paths.",
        ],
        [
          "Can the model read images?",
          "In the desktop app, each model shows its input capability tag from the backend catalogue and runtime status; the Laya and Qwen3 checkpoints there accept text. Windows RPA can extract text with local Windows OCR on CPU and pass that text to Laya, which is not image understanding. Chat images in this build stay previews.",
        ],
        [
          "Does Snake prove Laya is a better game-playing model?",
          "No. Snake is an interactive decision demonstration. The page explains how game state becomes a question and how rules check the selected direction. A game score is not a general benchmark or proof of model superiority, and this build cannot run the model at all.",
        ],
        [
          "Which languages and inputs are supported?",
          "The Laya decision checkpoint is English-only with a 256-token input window: long inputs lose information and non-English confidence is unreliable. That is a property of the checkpoint, not something this build enforces — it has no checkpoint. Local chat uses a separate model with its own context limits.",
        ],
        [
          "Which folders can the app read?",
          "The desktop app’s document workflow reads a directory you pick and writes a copy only after you approve the preview; it does not recursively index your laptop. This browser build reads nothing from disk unless you choose a file in the Files panel, and that file stays in the page.",
        ],
        [
          "Can I trust model confidence for unattended actions?",
          "Confidence can be wrong, especially for unfamiliar text, a language mismatch or a decision near a threshold. Test on your own examples and keep approval rules for consequential actions. Nothing here exposes unrestricted shell-command execution through a model.",
        ],
      ],
    ],
    [
      "Privacy and cost",
      [
        [
          "Does local inference send my text or audio to a cloud?",
          "In the desktop app, local decision, speech and chat inference run on the selected device; a BYOK endpoint receives the decision input you send it. In this browser build there is no inference and no endpoint, so nothing you type leaves the page.",
        ],
        [
          "What does the optional heartbeat send?",
          "That is a desktop-app feature driven by LAYA_PORTAL, which no code in this repository reads: this build sends no heartbeat. In the desktop app it reports a device ID, OS, architecture, app version and available devices, never prompts, audio, documents, paths or keys.",
        ],
        [
          "How do I use my own endpoint?",
          "That path is not wired in this build: configureEndpoint in src/lib/http.local.ts is an explicit no-op, so a key you paste is dropped rather than stored. In the desktop app you enter the endpoint and model on Compute & devices and choose Use this endpoint.",
        ],
        [
          "Does local chat save my conversations?",
          "Chats and attachments stay in this browser: sessions in sessionStorage (gone when the tab closes) and projects in localStorage (survives). Copy unsent text before reloading, and use the session controls to export or delete a chat.",
        ],
        [
          "What does it cost?",
          "Nothing in this build: there is no billing route and nothing is metered. Local inference in the desktop app costs the hardware, electricity, bandwidth and storage you already pay for. A hosted endpoint you connect follows that provider’s pricing. See Costs for the breakdown.",
        ],
      ],
    ],
    [
      "Troubleshooting · desktop app",
      [
        [
          "The app is disconnected. What should I do?",
          "That is the desktop app. Start it from its Windows shortcut or laya-npu.cmd, then choose Reconnect in the banner. Setup check can retry the server and hardware checks, and Server → Restart Laya reloads the runtime. This browser build has no server to reconnect and cannot show that banner.",
        ],
        [
          "The model output looks wrong. How do I debug it?",
          "Check the actual device shown in the result, use a short English input for Laya, and inspect every probability in Decision simulation. Compare the input with the question wording and policy rule. Repeatedly getting the same answer does not prove it is correct.",
        ],
        [
          "Installation failed. What now?",
          "That refers to the desktop installer, which is not part of this repository. Read its final error and rerun it after resolving the missing dependency or connection issue. Chat setup is separate from the decision model.",
        ],
        [
          "How do I report a problem?",
          "For this repository, include the app version, operating system, steps and error text, and remove private model input and keys. Read SECURITY.md for private security reporting; use GitHub issues for ordinary reproducible bugs. Desktop-app problems belong to that project.",
        ],
      ],
    ],
  ];
  let filter = $state("");
  let groups = $derived(
    GROUPS.map(([name, rows]) => ({
      name,
      rows: rows.filter(([q, a]) =>
        `${q} ${a}`.toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    })).filter((group) => group.rows.length),
  );
  let count = $derived(groups.reduce((total, group) => total + group.rows.length, 0));
</script>

<View
  title="Help & limits"
  icon="help"
  subtitle="What this build is, what belongs to the desktop app, and how to recover when a screen needs a capability that is not configured."
>
  {#snippet actions()}<label class="sr-only" for="help-search">Search help</label><input
      id="help-search"
      class="field min-w-0 sm:w-[240px]"
      type="search"
      bind:value={filter}
      placeholder="Search help"
    />{/snippet}
  {#if filter}<p class="mb-3 text-[12px] text-ink-2" role="status">
      {count} matching {count === 1 ? "answer" : "answers"}
    </p>{/if}
  {#each groups as group}<section class="mb-6">
      <h2 class="mb-2 text-[14px] font-semibold">{group.name}</h2>
      <div class="card overflow-hidden">
        {#each group.rows as [question, answer], i}<details
            class="border-line px-4 py-3 {i ? 'border-t' : ''}"
          >
            <summary class="text-[13px] font-medium">{question}</summary>
            <p class="mt-3 max-w-[75ch] text-[13px] leading-relaxed text-ink-2">{answer}</p>
          </details>{/each}
      </div>
    </section>{/each}
  {#if !count}<p class="py-6 text-[13px] text-ink-2">
      No matching help yet. Try a shorter keyword such as “chat”, “driver” or “files”.
    </p>
    <button class="btn self-start" onclick={() => (filter = "")}>Clear search</button>{/if}
</View>
