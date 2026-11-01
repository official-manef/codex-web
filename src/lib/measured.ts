// Placeholder template structure for benchmark measurements.
// This template ships no verified benchmark measurements for the local machine.

export const MEASURED = {
  date: "unmeasured",
  asrDate: "unmeasured",
  machine: "Template placeholder (unmeasured)",
  runtime: "Not measured",
  window: "256 tokens",
  iterations: 0,
  model: {
    parameters: 421293830,
    parameters_millions: 421,
    download_mb: 405,
    window_tokens: 256,
    parameter_source: "https://huggingface.co/api/models/convaiinnovations/laya",
    export_source: "https://huggingface.co/rupeshs/laya-ov-int8",
  },

  // Decision model (placeholder: no measurements shipped)
  decision: {
    NPU: { ms: null as number | null, compile_s: null as number | null },
    GPU: { ms: null as number | null, compile_s: null as number | null },
    CPU: { ms: null as number | null, compile_s: null as number | null },
  },

  // Whisper (speech, placeholder: no measurements shipped)
  asrAudioSeconds: 0,
  asr: {
    NPU: { s: null as number | null, realtime: null as number | null },
    CPU: { s: null as number | null, realtime: null as number | null },
    GPU: { s: null as number | null, realtime: null as number | null },
  },

  // Historical pipeline examples (unverified placeholder)
  pipeline: {
    date: "unverified",
    invoice: { audio_s: 0, asr_s: 0, decision_s: 0, total_s: 0, realtime: 0 },
    outage: { audio_s: 0, asr_s: 0, decision_s: 0, total_s: 0, realtime: 0 },
    first_request_s: 0,
  },

  // Headline figures (placeholder: no measurements shipped)
  headline: {
    perQuestionMs: null as number | null,
    asrRealtime: null as number | null,
    whisperSizeMb: 85,
    costPerRequest: "$0",
  },
};

export function decisionMs(device: string): number | null {
  const row = MEASURED.decision[device.toUpperCase() as keyof typeof MEASURED.decision];
  return row ? row.ms : null;
}
