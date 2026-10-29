# 0015. Cloud settings are the source of truth; pods pull, clients never push

Accepted 2026-10-29.

## Context

The TUI pushed its whole settings document to every attached pod, replacing the Project-scoped
values serve had pulled from Atlas Cloud. A web-started pod and a TUI-started pod therefore ran
with different settings. Signed in, the TUI also layered a project `.atlas/settings.json` and
`ATLAS_*` variables over its Cloud values, so it showed something the web did not. Which settings
were Cloud was decided by settings page, which put terminal-only and session-shaping settings on
the same page.

## Decision

- **Cloud is the source of truth for settings.** The TUI and the web are equal clients of it.
- **Pods pull, clients never push.** Serve reads Cloud scoped config at boot and again before each
  turn. It ignores and logs an `EClientFrame.Settings` frame.
- **Storage is per setting.** Each definition carries `storage`, Cloud by default. Local settings
  are the terminal and host ones: appearance, transcript and sidebar display, usage meters,
  notifications, editor, auto-restart, execution location, container sizing, `experimental.pods`,
  `placement.lastBorn`, the placement chooser shape and the Vercel token.
- **Signed in, Cloud settings resolve from Cloud only.** The project settings file and the
  `ATLAS_*` environment layer do not apply to them, in the TUI and in serve. This holds in-process
  too: with pods off, a signed-in TUI still reads Cloud settings. Signed out, everything is local.
- **Vercel.** Signed in, every new Vercel birth provisions through the API. Threads already born
  directly from the TUI keep their local credentials.

## Why

One place to change a setting, and every session of every kind sees it. A client push cannot tell
a Project-scoped value from a user one, so it erased the former. Deciding by setting rather than
by page keeps terminal-only settings local without hiding session-shaping ones from the web.

## Consequences

- The web edits every Cloud setting the TUI does.
- A project `.atlas/settings.json` no longer affects Cloud settings of a signed-in session; the
  Project's Cloud settings do.
- Settings changes reach a running pod on its next turn. MCP config is rewritten then but servers
  connect at boot, so an MCP change needs a pod restart.
- Secrets and accounts stay Cloud-backed only with `experimental.pods` on; settings do not need it.
- Old clients that still send a settings frame are ignored, so a serve release is required.
- Local values are not imported ([0012](0012-cloud-state-starts-empty.md)).
