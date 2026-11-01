export type RecoveryLink = { label: string; href: string };

/** Recovery choices are navigation only. No failed write or download is retried here. */
export function recoveryFor(message: string): {
  hint: string;
  links: RecoveryLink[];
  reload: boolean;
} {
  if (/recording limit.*reach/i.test(message))
    return {
      hint: "Pick an old run in Saved recordings and press Delete recording after you have read it, then start a new run.",
      links: [],
      reload: false,
    };
  if (/captcha|automated.traffic|consent prompt|google.*blocked/i.test(message))
    return {
      hint: "The external site blocked this browser run. Read the recording, try again later, or use Windows RPA for the installed Solitaire app in the desktop app.",
      links: [],
      reload: false,
    };
  if (/native|Solitaire|local OCR|Windows.*app|observed Hint|accessibility tree/i.test(message))
    return {
      hint: "Open the Windows game, dismiss any prompt yourself, and keep its window visible. Read the captured frame before starting another attempt. An uncertain observation stops without a click.",
      links: [{ label: "Windows RPA", href: "#apps" }],
      reload: false,
    };
  if (/401|unauthori[sz]ed|bearer|access token/i.test(message))
    return { hint: "Reload the app to refresh its access token.", links: [], reload: true };
  if (
    /fetch|network|connection|cannot reach|disconnected|failed to load|server.*unavailable/i.test(
      message,
    )
  )
    return {
      hint: "Reload the page. If that does not clear it, this build has no runtime to reconnect to; the desktop app is the build that has one.",
      links: [{ label: "Paired devices", href: "#devices" }],
      reload: true,
    };
  if (
    /not verified for|unsupported.*device|unavailable.*device|device.*unavailable|compile|driver/i.test(
      message,
    )
  )
    return {
      hint: "Read the selected model and device. The app only switches device when you choose one.",
      links: [
        { label: "Compute & devices", href: "#backends" },
        { label: "Setup check", href: "#setup" },
      ],
      reload: false,
    };
  if (
    /not installed|missing|pip install|openvino|numpy|tokenizer|not set|no .*model/i.test(message)
  )
    return {
      hint: "Setup check names which piece is missing. Installing it is the desktop app's job: this build has no package manager and no model directory.",
      links: [
        { label: "Setup check", href: "#setup" },
        { label: "Models & downloads", href: "#models" },
      ],
      reload: false,
    };
  if (/expired|preview|destination.*occupied|already exists/i.test(message))
    return {
      hint: "Review a fresh preview before approving this operation again.",
      links: [],
      reload: false,
    };
  if (/busy|already running|operation.*progress|429|rate limit|too many requests/i.test(message))
    return {
      hint: "Wait for the current operation to finish, or stop it before trying again.",
      links: [],
      reload: false,
    };
  if (/microphone|permission|denied/i.test(message))
    return {
      hint: "Check the browser's permission for this site, then use the record control again.",
      links: [],
      reload: false,
    };
  if (/context|token.*limit|too many messages|conversation.*full/i.test(message))
    return {
      hint: "Shorten the message or start a new chat. The saved chat keeps every turn you already sent.",
      links: [{ label: "Open Chat", href: "#chat" }],
      reload: false,
    };
  return {
    hint: "Your input is preserved. Check the settings or correct the input before trying again.",
    links: [{ label: "Setup check", href: "#setup" }],
    reload: false,
  };
}
