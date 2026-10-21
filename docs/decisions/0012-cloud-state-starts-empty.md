# 0012. Pod mode starts empty: no import, no old threads

Accepted 2026-10-20.

## Context

Moving a user's state to Atlas Cloud raised two questions. Should existing local settings,
secrets and API-key accounts be imported, and should threads that ran on the host appear among
pod threads?

## Decision

- **No import.** The cloud stores start empty. The user re-enters API keys and Vercel settings once.
  Local `settings.json`, `secrets.json` and `auth.json` stay on disk and are never copied up.
  Signed in, pod mode reads them only for local-only keys: Appearance, Experimental and Hidden
  settings, and client-held `sandbox-serve:*` and `mcp-oauth:*` secrets.
- **Old threads are greenfield.** With pods on, the thread list shows only cloud-placed threads
  (`apps/tui/src/composition/cloud/cloud-listing.ts`). Host and docker threads are hidden, not
  migrated, and nothing under `~/.atlas/sessions` is deleted.

## Why

An importer and a compatibility mode are code to maintain for a one-time move by a small team.
Re-entering a few keys costs minutes.

## Consequences

- OAuth logins were already in the cloud (0005), so only API keys and settings need re-entering.
- With `experimental.pods` off, local state is read as before and host threads list again; see 0013.
