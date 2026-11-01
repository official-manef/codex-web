<script lang="ts">
  import View from "#lib/View.svelte";
  const GROUPS: [string, [string, string][]][] = [
    [
      "This browser build",
      [
        [
          "What am I looking at?",
          "A workspace shell copied from the laya-npu desktop app and served in a browser. There is no server, no model and no NPU access here. A screen that needs one says so instead of pretending, and no inference runs.",
        ],
        [
          "How do I read the rest of this page?",
          "Answers that describe Laya, Whisper, the Intel NPU, Windows RPA or model downloads describe the desktop app on Windows. This build has none of those paths, so treat those answers as documentation of another product rather than a promise about this one.",
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
          "Open Start here and pick Decision simulation, Automation, Chat or Voice to action. Decision simulation loads an example input so you can test a rule without running anything. Setup check reports the server and device status in the desktop app, and reports them as not configured here.",
        ],
        [
          "What is Laya?",
          "A decision classifier: give it short English text and typed questions to get a label, score or yes/no probability. It can pick a wrong label with high confidence, so your application rules decide which action is allowed. Nothing in this browser build runs it.",
        ],
        [
          "Can I chat with it?",
          "In the desktop app the chat uses a separate generative model, and each reply shows the device, the timing and the output speed it actually used. This build has no model installed, so a send comes back as “No provider configured”.",
        ],
        [
          "What is Jev?",
          "Jev System One is the typed question-and-answer protocol the decision model speaks: one state, and questions of type choice, score or noul.",
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
          "In the desktop app the NPU path uses Intel AI Boost through OpenVINO on Windows, and Setup check inspects the devices its local server reports. Other vendors’ neural processors are not supported there. This build has no device access at all, so Setup check reports no server because there is none.",
        ],
        [
          "Why is my NPU missing in WSL?",
          "The desktop app runs on Windows and its NPU path needs the Windows driver; it cannot reach the NPU from WSL or a virtual machine. That is a desktop-app limit, and this page cannot test it: there is no device access here at all.",
        ],
        [
          "Should I install Intel’s driver or my laptop maker’s?",
          "Start with the laptop vendor’s supported driver. The desktop app’s Compute & devices screen shows the installed Intel NPU driver, the available version and a download link when one applies; installing it needs administrator rights and a reboot. This build’s Compute & devices screen reports no driver, because it has no server to read one from.",
        ],
        [
          "Is NPU always the fastest device?",
          "No. It depends on the model and the workload. An NPU suits short decision questions and speech recognition; sequential chat generation often runs faster on a GPU. Model architecture, quantisation and driver support all change the answer.",
        ],
        [
          "Why does the first request take longer?",
          "OpenVINO compiles a model for the selected device the first time it runs, and the cost varies by device. Chat and speech compile separately, and cached kernels usually make later starts faster.",
        ],
      ],
    ],
    [
      "Automation and inputs · desktop app",
      [
        [
          "What can Automation do on my laptop?",
          "In the desktop app, Windows RPA observes the installed Microsoft Solitaire app and uses local text perception before a fixed policy may request one Hint. It preserves your game and records actual screenshots. Browser adapters run reviewed steps without AI and wait for you when a site requires CAPTCHA or consent. The document workflow classifies text with Laya and saves a copy only after you approve it. Decision simulation’s invoice policy tab only evaluates rules: it does not contact an ERP, write a file or control an application. This build runs none of those paths.",
        ],
        [
          "Can the model read images?",
          "In the desktop app each model shows an input capability tag taken from the backend catalogue and its runtime status, and the Laya and Qwen3 checkpoints there take text. Windows RPA can pull text out with local Windows OCR on the CPU and pass that text to Laya, which is not image understanding. An image attached to the chat in this build stays a preview.",
        ],
        [
          "Does Snake prove Laya is a better game-playing model?",
          "No. Snake is a decision demonstration: the page shows how a game state becomes a question and how a rule checks the chosen direction. A game score is not a benchmark and not evidence that one model beats another, and this build cannot run a model to produce one.",
        ],
        [
          "Which languages and inputs are supported?",
          "The Laya decision checkpoint takes English only, in a 256-token input window: a long input loses detail, and confidence on non-English text is unreliable. That describes the checkpoint, and this build ships none. The chat uses a separate model with its own context limit.",
        ],
        [
          "Which folders can the app read?",
          "The desktop app’s document workflow reads a directory you pick and writes a copy only after you approve the preview. It does not index the rest of the disk. This build reads nothing unless you choose a file in the Files panel, and that file stays in the page.",
        ],
        [
          "Can I trust model confidence for unattended actions?",
          "Confidence can be wrong, especially on unfamiliar text, across a language mismatch, or on a decision near a threshold. Test your own examples and keep an approval rule for anything consequential. No model in either build can run an unrestricted shell command.",
        ],
      ],
    ],
    [
      "Privacy and cost",
      [
        [
          "Does local inference send my text or audio to a cloud?",
          "In the desktop app, decision, speech and chat inference run on the selected device, and an endpoint receives only the input you send it. This build has no inference and no endpoint, so nothing you type leaves the page.",
        ],
        [
          "What does the optional heartbeat send?",
          "That belongs to the desktop app, driven by LAYA_PORTAL, a variable no code in this repository reads, so this build sends no heartbeat. There it reports a device id, the OS, the architecture, the app version and the available devices, and never a prompt, audio, a document, a path or a key.",
        ],
        [
          "How do I use my own endpoint?",
          "That path is not wired in this build: configureEndpoint in src/lib/http.local.ts is an explicit no-op, so a key you paste is dropped rather than stored. In the desktop app you enter the endpoint and model on Compute & devices and press Use this endpoint.",
        ],
        [
          "Does the chat save my conversations?",
          "Chats and attachments stay in this browser: chats in sessionStorage, which a tab close discards, and projects in localStorage, which survives. Copy unsent text before reloading, and use the chat controls to export or delete one.",
        ],
        [
          "What does it cost?",
          "Nothing in this build: there is no billing route and nothing is metered. Local inference in the desktop app costs the hardware, the electricity, the bandwidth and the storage you already pay for, and an endpoint you connect follows that provider’s own pricing.",
        ],
      ],
    ],
    [
      "Troubleshooting · desktop app",
      [
        [
          "The app is disconnected. What should I do?",
          "That is the desktop app. Start it from its Windows shortcut or laya-npu.cmd, then press Reconnect in the banner. Setup check retries the server and hardware checks, and Server then Restart Laya reloads the runtime. This build has no server to reconnect and cannot show that banner.",
        ],
        [
          "The model output looks wrong. How do I debug it?",
          "Read the device shown in the result, keep the input short and English, and inspect every probability in Decision simulation. Compare the input against the question wording and the policy rule. Getting the same answer twice is not evidence that it is right.",
        ],
        [
          "Installation failed. What now?",
          "That refers to the desktop installer, which is not part of this repository. Read its final error, fix the missing dependency or the connection it names, then rerun it. The chat model is installed separately from the decision model.",
        ],
        [
          "How do I report a problem?",
          "For this repository, include the version, the operating system, the steps and the error text, and strip private model input and any key. SECURITY.md covers private security reports; GitHub issues cover reproducible bugs. Desktop-app problems belong to that project.",
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
