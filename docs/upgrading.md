# Upgrading from pre-1.0 (harness.db)

Before 1.0, Atlas kept every session in a single SQLite database at `~/.atlas/harness.db`.
Atlas 1.0 replaces it with per-session JSONL files under `~/.atlas/sessions/<session-id>/`
(one `events.jsonl` per thread, plus metadata and a turn ledger), so a session is a plain
directory you can read, grep, and back up on its own.

The upgrade does **not** import the old database. Until you export it, your pre-1.0 sessions
do not appear in `/resume`. While an unimported `harness.db` exists, Atlas shows a notice on
every start with the exact command for your paths — the notice keeps coming back until the
export runs, so you cannot lose it by starting a conversation first.

## Importing your old sessions

With the shipped binary:

```sh
atlas export-harness-db
```

Both paths default to your Atlas home, so the explicit form is:

```sh
atlas export-harness-db --db ~/.atlas/harness.db --home ~/.atlas
```

If you set `ATLAS_HOME` to a custom directory, the defaults follow it — no flags needed.

From a source checkout instead of the binary:

```sh
bun packages/harness/scripts/export-harness-db.ts --db ~/.atlas/harness.db --home ~/.atlas
```

The export prints a summary (sessions, threads, events, turns) and verifies that every event
landed on disk. It is safe to re-run: it rewrites the imported session directories from the
source of truth. A successful export writes `~/.atlas/sessions/.imported-from-harness-db`,
which is what silences the startup notice — delete that marker if you ever want the notice
back.

## The old database is your backup

`harness.db` is opened read-only and left exactly where it was. Nothing deletes or modifies
it — once you have confirmed your sessions show up in `/resume`, removing it is your call.
