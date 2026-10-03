# webterm

Dev-only remote terminal for this repo. It exists for one job: when you're inside an
environment with no real terminal (a cloud sandbox, a container), you point a browser at
it and get a shell that can run `atlas-dev` from this checkout, against a **scratch
`ATLAS_HOME`** that has your credentials seeded into it.

It is not part of the product. Nothing in it ships in the `atlas` binary.

Opening the URL drops you straight into `atlas-dev` (this checkout, from source) — exiting
the TUI leaves you in the seeded shell. Set `WEBTERM_AUTOLAUNCH=0` for a plain shell instead.

## Two flavors

```bash
cd apps/webterm

bun run dev    # custom: xterm.js page + Bun WebSocket + PTY via the system `script` util
bun run ttyd   # ttyd: the real ttyd binary, auto-downloaded on Linux, same seeded home
```

Both print a URL on boot. In a cloud sandbox, expose the port the same way any dev
server's port is exposed, then open the URL in your browser and run:

```
atlas-dev                     # this checkout, from source
atlas-dev --worktree <slug>   # a worktree's code
```

## What the dev home is and why it's scratch

Every boot seeds `<repo>/.atlas-home/webterm` (gitignored) from the real atlas home:
`key`, `auth.json`, `cloud.json`, `secrets.json`, `settings.json`, `mcp.json`,
`telemetry.json`, the instruction files, and the `memory/`, `projects/`, `skills/` trees.
Copies are mtime-aware (newer source wins, nothing is ever deleted), so re-logins on the
real home propagate, but experiments inside the terminal never touch the real home.

That isolation is deliberate — a dev probe once overwrote the session's real cloud
sign-in file. If you want a completely fresh seed: `WEBTERM_RESET_HOME=1 bun run dev`.

## Configuration (all optional env)

| Var                  | Default                              | Meaning                                  |
| -------------------- | ------------------------------------ | ---------------------------------------- |
| `WEBTERM_PORT`       | `7681`                               | Port to listen on                        |
| `WEBTERM_TOKEN`      | random per boot                      | Access token (`?token=` / basic auth)    |
| `WEBTERM_SOURCE_HOME`| `$ATLAS_HOME` or `~/.atlas`          | Home to seed credentials from            |
| `WEBTERM_HOME`       | `<repo>/.atlas-home/webterm`         | Scratch home the terminal runs against   |
| `WEBTERM_CWD`        | repo root                            | Shell start directory                    |
| `WEBTERM_RESET_HOME` | unset                                | `1` wipes and re-seeds the scratch home  |
| `WEBTERM_AUTOLAUNCH` | `1`                                  | `0` opens a plain shell, no auto `atlas-dev` |

The token matters on the sandbox: the exposed URL is effectively public, so the page and
the websocket both refuse connections without it.

## Differences between the flavors

- **`bun run dev`** (the default) owns the wire protocol (JSON text frames for
  input/resize/ping, binary frames for output) and handles resize via `stty -F` on the
  discovered pts.
- **`bun run ttyd`** (fallback) downloads ttyd 1.7.7 into the scratch home's `bin/` on
  first use (Linux only; on macOS `brew install ttyd` and it'll be found on `PATH`). Auth
  is HTTP basic — enter the token as both username and password. Its frontend occasionally
  settles on a grid smaller than the viewport; reload at final window size. Note the child is launched as
  `bash --rcfile …` without `-i`: bash under a pty is interactive anyway, and a `-i`
  anywhere in the child argv crashes the ttyd 1.7.7 static build outright (getopt
  re-parses the child arguments).

Both spawn one shell per browser tab, and kill it when the tab disconnects.

## Layout

- `src/server.ts` — Bun HTTP + WebSocket server (`bun run dev`)
- `src/ttyd.ts` — ttyd locator/downloader and launcher (`bun run ttyd`)
- `src/dev-home.ts` — scratch-home seeding + shell rc generation
- `src/pty.ts` — PTY spawn, pts discovery, resize
- `src/protocol.ts` — client message parsing (pure)
- `src/public/index.html` — the xterm.js page (CDN deps, no build step)
