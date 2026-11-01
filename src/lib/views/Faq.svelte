<script lang="ts">
  import View from "#lib/View.svelte";
  const GROUPS: [string, [string, string][]][] = [
    [
      "Getting started",
      [
        [
          "Which task should I start with?",
          "Open Start here and choose Workflow Studio, Local chat or Voice to action. Decision simulation includes sample inputs for testing rules without running actions. Setup check shows the server and local device status.",
        ],
        [
          "What is Laya?",
          "Laya is a decision classifier. Give it short English text and typed questions to get a label, score or yes/no probability. It can choose a wrong label with high confidence. Your application rules decide what action is allowed.",
        ],
        [
          "Can I chat with it?",
          "Local chat uses a separate generative LLM to write replies. Install or load that model in the Local chat page, choose its device, then send a message. Laya itself does not generate prose. Chat replies show the actual device, timing and output speed.",
        ],
        [
          "What is Jev?",
          "Jev System One is the typed question-and-answer protocol used by the decision model. It describes a state and questions of type choice, score or noul. This project uses Laya for local inference and accepts a compatible endpoint through BYOK.",
        ],
        [
          "What do choice, score and noul mean?",
          "choice selects from named options and returns their probabilities. score places input on an ordered scale. noul answers a yes/no question with P(yes). A model probability is a signal to evaluate, not proof that the answer is correct.",
        ],
      ],
    ],
    [
      "Hardware and speed",
      [
        [
          "Does my computer have a supported NPU?",
          "This app’s NPU integration uses Intel AI Boost through OpenVINO on Windows. Use Setup check to inspect the devices reported by the local server. Other vendors’ neural processors are not supported by this integration.",
        ],
        [
          "Why is my NPU missing in WSL?",
          "This project cannot access the Windows NPU from WSL or a virtual machine. Run the Windows app to use the Intel NPU. The installer detects WSL and hands off to Windows. Available GPU or CPU devices can still be selected explicitly.",
        ],
        [
          "Should I install Intel’s driver or my laptop maker’s?",
          "Start with the laptop vendor’s supported driver. Compute & devices shows the installed Intel NPU driver, available version information and a download link when appropriate. Installing a driver may require administrator rights and a reboot.",
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
      "Workflow Studio and inputs",
      [
        [
          "What can Workflow Studio do on my laptop?",
          "Windows RPA observes the installed Microsoft Solitaire app and uses local text perception before a fixed policy may request one Hint. It preserves your game and records actual screenshots. Browser adapters run reviewed steps without AI and wait for you when a site requires CAPTCHA or consent. Document workflow classifies text with Laya and saves a copy only after approval. Explore → Decision simulation → Invoice policy only evaluates rules; it does not contact an ERP, write files or control applications.",
        ],
        [
          "Can the model read images?",
          "Each model shows its input capability tag from the backend catalogue and runtime status. The bundled Laya and Qwen3 models accept text. Chat images remain previews. Windows RPA can extract text using local Windows OCR on CPU, then pass that text to Laya on the selected device; this does not give the model image understanding. Custom checkpoints remain unverified until supported explicitly.",
        ],
        [
          "Does Snake prove Laya is a better game-playing model?",
          "No. Snake is an interactive decision demonstration. The page explains how game state becomes a question and how rules check the selected direction. A game score is not a general benchmark or proof of model superiority.",
        ],
        [
          "Which languages and inputs are supported?",
          "The shipped Laya decision checkpoint is English-only and has a 256-token model input window. Long inputs can lose information; non-English model confidence is unreliable. Local chat uses its separate model and context limits. Audio accepts the formats listed in Transcribe audio, subject to converter availability and upload limits.",
        ],
        [
          "Which folders can the app read?",
          "Document corpus reads only a directory you provide under the configured allowed roots; it does not recursively index your laptop. Workflow Studio has its own bounded workspace and shows its input and output locations. Use the preview before saving any copies.",
        ],
        [
          "Can I trust model confidence for unattended actions?",
          "Confidence can be wrong, especially for unfamiliar text, a language mismatch or a decision near a threshold. Test on your own examples and keep approval rules for consequential actions. The app does not expose unrestricted shell-command execution through Laya.",
        ],
      ],
    ],
    [
      "Privacy and cost",
      [
        [
          "Does local inference send my text or audio to a cloud?",
          "Local decision, speech and chat inference run on the selected device. BYOK sends decision inputs to your configured endpoint. Model downloads and optional device registration use the network, but they are separate from local inference.",
        ],
        [
          "What does the optional heartbeat send?",
          "When LAYA_PORTAL is configured, the app sends a device ID, OS, architecture, app version and available device information about every five minutes. It does not send prompts, audio, documents, paths or API keys. Remove LAYA_PORTAL from .env and restart to disable it.",
        ],
        [
          "How do I use my own endpoint?",
          "Open Compute & devices, enter an http or https endpoint speaking Jev System One, enter the model and optional key, then choose Use this endpoint. Credentials remain in the current tab’s memory. Private targets are refused by default; advanced local-network use requires explicit server configuration.",
        ],
        [
          "Does local chat save my conversations?",
          "Chats and their attachments are saved locally on this laptop. Reloading or restarting preserves saved sessions; unsent text should be copied before restarting. Use session controls to export or delete a chat. A generative model can make mistakes; review important outputs.",
        ],
        [
          "What does it cost?",
          "This app does not meter local requests, transcription minutes or chat tokens. You supply the hardware, electricity, bandwidth and storage. Optional hosted endpoints follow their provider’s pricing. See Costs for the breakdown.",
        ],
      ],
    ],
    [
      "Troubleshooting",
      [
        [
          "The app is disconnected. What should I do?",
          "Start the app from its Windows shortcut or laya-npu.cmd, then choose Reconnect in the banner. Setup check can retry the server and hardware checks. Server → Restart Laya reloads the runtime after active work finishes and reconnects when a new instance is ready. The top bar shows connection state and the selected device.",
        ],
        [
          "The model output looks wrong. How do I debug it?",
          "Check the actual device shown in the result, use a short English input for Laya, and inspect every probability in Decision simulation. Compare the input with the question wording and policy rule. Repeatedly getting the same answer does not prove it is correct.",
        ],
        [
          "Installation failed. What now?",
          "Read the installer’s final error and rerun it after resolving the missing dependency or connection issue. Completed setup steps are reused. Chat setup is separate from the decision model; open Local chat for its install/load status.",
        ],
        [
          "How do I report a problem?",
          "Include the app version, operating system, selected device, steps and error text. Remove private model input and keys. Read SECURITY.md in the repository for private security reporting; use GitHub issues for ordinary reproducible bugs.",
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
  subtitle="Find the right task, understand the models, and recover when something needs attention."
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
