<script lang="ts">
  import View from "#lib/View.svelte";
  const GROUPS = [
    {
      title: "Decision request payload schema (unimplemented)",
      rows: [
        [
          "state",
          "string | object",
          "The short input text or named state fields the questions refer to. Laya has a 256-token model window.",
        ],
        [
          "questions",
          "object",
          "Map of question ID to {type, instructions, criteria}. Use 2–8 options for choice and 2–8 levels for score.",
        ],
        [
          "backend",
          "string",
          "Choose local:npu, local:gpu, local:cpu or byok. An omitted backend uses the server default.",
        ],
        [
          "state_key",
          "string",
          "For a string state, the field name used by the question. Defaults to state. Object state preserves its field names.",
        ],
      ],
    },
    {
      title: "Question format",
      rows: [
        [
          "type",
          "choice | score | noul",
          "choice picks a label; score places input on an ordered scale; noul returns a yes/no probability.",
        ],
        [
          "instructions",
          "string",
          "Ask a clear question and name the input field in backticks, for example `text`. The server keeps up to 600 characters.",
        ],
        [
          "criteria",
          "object | array",
          "choice: {label: condition}. score: an ordered array of level descriptions. noul: {true: condition, false: condition}.",
        ],
      ],
    },
    {
      title: "Decision response schema (unimplemented)",
      rows: [
        [
          "answers[]",
          "array",
          "Summary rows with id, type, value and probability. Choice includes ranked options; score includes its scale.",
        ],
        [
          "probability",
          "number",
          "For choice: probability of the selected label. For noul: P(yes), even when the reported boolean is false. Score uses its returned confidence.",
        ],
        [
          "raw",
          "object",
          "The underlying typed model answers, keyed by question ID. Use this when inspecting full distributions.",
        ],
        [
          "device / ms",
          "string / number",
          "The device used and total measured time across the questions. Total can include first-time compilation.",
        ],
      ],
    },
  ];
</script>

<View
  title="Model parameters"
  icon="sliders"
  subtitle="Reference schema for hypothetical decision parameters. Note: POST /api/custom does not exist in this repository; no live endpoint is implemented."
>
  <p class="mb-5 max-w-[75ch] text-[13px] leading-relaxed text-ink-2">
    This reference describes a hypothetical decision request format. No <code>POST /api/custom</code>
    route is implemented in this repo, and no live decision server is connected.
  </p>
  {#each GROUPS as group}<section class="mb-6">
      <h2 class="mb-2 text-[14px] font-semibold">{group.title}</h2>
      <dl class="card overflow-hidden">
        {#each group.rows as [name, type, description], i}<div
            class="grid grid-cols-1 gap-1 px-4 py-3 lg:grid-cols-[1fr_1.2fr_2.5fr] lg:gap-4 {i
              ? 'border-t border-line'
              : ''}"
          >
            <dt class="mono text-[12px]">{name}</dt>
            <dd class="mono break-words text-[11px] text-ink-2">{type}</dd>
            <dd class="max-w-[75ch] text-[12px] leading-relaxed text-ink-2">{description}</dd>
          </div>{/each}
      </dl>
    </section>{/each}
  <p class="text-[12px] leading-relaxed text-ink-2">
    The decision classifier does not sample text, so temperature and chat token limits are not
    controls for this endpoint. Keep consequential actions behind explicit application rules.
  </p>
</View>
