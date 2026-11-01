# Terminology

One term per concept, in the UI and in the code comments that describe the UI. The table is
the mapping; the notes below it record the exceptions, because some strings are held in place
by `tests/acceptance.e2e.ts` and must not drift.

## The mapping

| Concept                                   | Use                        | Do not use                                         | Where it shows                                                             |
| ----------------------------------------- | -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| One saved conversation with the assistant | **chat**                   | session, conversation, thread                      | sidebar rows, `New chat`, `Rename chat`, `Delete chat`, `Search chats`     |
| One destination open in the second region | **output tab**, or **tab** | canvas, panel, view (when the tab is meant)        | tab strip, `Open output tabs`, `Close {label} tab`                         |
| The whole second region                   | **output panel**           | work region, canvas, output workspace              | `Toggle output panel`, `Show/Hide output panel`, `Expand output panel`     |
| One NPU / GPU / CPU used for inference    | **device**                 | engine, backend (in prose), processor              | `Compute & devices`, comparison tables, `Visible workspace region`         |
| An HTTP model provider you supply a key   | **endpoint**               | provider (for the thing), backend                  | `Your own endpoint`, `Connect provider` (button on the endpoint form only) |
| A machine paired over a bridge            | **paired device**          | device row, remote, node                           | `Paired devices` settings screen                                           |
| This app                                  | **workspace**              | shell, app, console, desktop                       | `Workspace navigation`, `What would you like to do?`                       |
| The thing the reader is looking at        | **this browser build**     | this build, this template, this repository         | every screen that scopes a claim to this build                             |
| The laya-npu app on Windows               | **the desktop app**        | Laya (alone), upstream, original app               | `Help & limits`, `Costs`                                                   |
| A user's machine that is not the browser  | **this machine**           | this laptop, this computer (in browser-build copy) | `Runs on this machine`                                                     |

## Why these

- **chat, not session.** `http.local.ts`, `sessionStorage` and `api.session*` keep the word
  `session` because it names a storage record, not a screen. The user sees `chat`, which is
  what the buttons already said (`New chat`, `Rename chat`).
- **output panel vs tab.** The panel is the region; a tab is one screen inside it. The old
  copy used "canvas" for the region in `Devices.svelte` and "work region" in the shell's
  history, and both read as a third thing.
- **device, not engine.** `engine` appeared in `Costs` and in the comparison table while every
  other screen said `device`. Two names for NPU/GPU/CPU is the defect this file exists to stop.
- **endpoint, not provider.** `Providers` is the name of a settings screen (the list of
  backends), so the noun stays on the screen title and stops being used for the BYOK URL. A
  URL you paste is an endpoint.
- **this browser build.** Four spellings were in use (`this build`, `this template`,
  `this browser build`, `this repository`) for the same scope. One spelling, one meaning: the
  code you are running, which has no backend.

## Locked strings

These are asserted verbatim by `tests/acceptance.e2e.ts` or `tests/dev-smoke.e2e.ts`. A copy
edit may not rename them; if one ever has to change, the test changes in the same commit and
the reason is written next to it.

| String                                                                         | Held by                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------- |
| `Chat sessions` (`aside` aria-label)                                           | AC15, scopes the search assertion to the list |
| `No matching chats.` / `Your saved chats appear here.`                         | AC15                                          |
| `Open output tabs` (tablist aria-label)                                        | AC08                                          |
| `Toggle output panel`, `Show output panel`                                     | AC08                                          |
| `No matching open tab.`                                                        | AC18                                          |
| `Visible workspace region` (group aria-label)                                  | AC10                                          |
| `What would you like to do?`                                                   | AC01, dev-smoke                               |
| `Help & limits`                                                                | AC14, dev-smoke                               |
| `Generation stopped. Partial replies, if any, are shown above.`                | AC06                                          |
| `File is too large. Choose a smaller file.` / `Other attached files were kept` | AC03                                          |
| `Preview only · model cannot see this file`                                    | AC02                                          |
| `No provider configured`                                                       | dev-smoke                                     |
| `Choose files or a folder`                                                     | dev-smoke                                     |
| `Tools`, `User menu`, `Help`, `More tools`                                     | AC11, AC12, AC14                              |

`Chat sessions` is the one place the mapping bends: the landmark says `Chat sessions` while
every control inside it says `chat`. Renaming it to `Chats` would be more consistent and is a
one-line change, but it moves a tested selector for no user-visible gain, so it stays and is
recorded here instead.
