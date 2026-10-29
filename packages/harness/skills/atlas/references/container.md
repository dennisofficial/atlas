# Container image and setup

When a thread's tools run in local Docker (`/container docker`, or a host-born thread switched to Docker), Atlas
picks the image, setup commands, env and extra mounts from files in the repo (and optionally the Atlas home).
This page covers how that choice is made, every `.atlas/container.json` field, the notes Atlas may show, and a
recipe for setting up a repo. Nothing here changes how the host or a cloud sandbox behaves (see "Where it applies").

## Resolution order

Atlas takes the first source that yields a config, re-reading files each time the sandbox is anchored to a directory:

1. `.atlas/container.json` in the project directory.
2. `.devcontainer/devcontainer.json` — only if it has an `image` or a string `postCreateCommand`.
3. `.atlas/Dockerfile` in the project (built; build context is the whole `.atlas/` directory).
4. `Dockerfile` in the Atlas home directory (built; context is that single file).
5. The built-in default image, `ghcr.io/dennisofficial/atlas-sandbox:latest`, silently.

A source that is invalid (see "Warnings") does not stop resolution: Atlas warns and falls through to the next one.
Sources do not merge; `container.json` wins outright, so a `postCreateCommand` in a devcontainer is not combined with it.
`container.json` that omits `image` uses the default image (which already bakes the toolchain), not a lower source.

## `.atlas/container.json`

Parsed as JSONC: `//` and `/* */` comments and trailing commas are fine. Unknown keys are an error (typos are not
silently dropped). Every field is optional.

| Field    | Type                                         | Meaning                                                                                                     |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `image`  | non-empty string                             | Image reference to run (e.g. `node:22-bookworm`). Omitted: the default Atlas image.                         |
| `dockerfile` | non-empty string                         | Dockerfile to build instead, relative to `.atlas/` and inside it. Cannot be combined with `image`.          |
| `setup`  | non-empty string                             | Shell script (`sh -c`) run once, as root, in the repo directory, right after the container is first created. |
| `start`  | non-empty string                             | Shell script run as the normal user in the repo directory every time the sandbox is brought up.             |
| `env`    | object of string → string                    | Env vars set on the container. Changing them recreates the container.                                       |
| `mounts` | array of `{ "path": string, "mode"?: "ro"\|"rw" }` | Extra host paths bind-mounted at the same absolute path inside. `mode` defaults to `ro`.              |

```json
{
  "image": "oven/bun:1.3",
  "setup": "apt-get update && apt-get install -y ripgrep && bun install",
  "start": "docker compose up -d db",
  "env": { "TURBO_CACHE_DIR": "/tmp/turbo-cache" },
  "mounts": [
    { "path": "/Users/me/Developer/shared-lib" },
    { "path": "/Users/me/.cache/bun", "mode": "rw" }
  ]
}
```

Behaviour of the scripts:

- `setup` runs only when the container is newly created. If it exits non-zero the sandbox fails to start with the
  last ~2000 characters of output; fix the script, remove the container and start again. Setup does not rerun when
  the container is merely restarted or reused.
- `start` runs on every bring-up, including reuse of an existing container. A non-zero exit only produces a warning.
- Changing `image`, `env`, `mounts` or limits makes Atlas remove and recreate the container at the next start. If it
  was running, its shells are killed (Atlas says so); `setup` then runs again.

Mounts: paths must be absolute, must not contain a `..` component, must be ≤ 512 characters after normalisation
(doubled and trailing slashes are cleaned), and may not be `/` or sit on, above or below `/etc /usr /bin /sbin /lib
/lib64 /boot /proc /sys /dev /run`. A bad mount is dropped with a warning; the other mounts and fields still apply.
Atlas also adds, without being asked: the worktree, git metadata outside the worktree if any, and the Atlas home
subtrees `memory skills agents projects sessions services bin` (read-write). The Atlas home root, auth and vault
key are never mounted: credentials do not enter the container.

## devcontainer.json

Only `image` and a string `postCreateCommand` (used as `setup`) are honoured; everything else (`features`,
`build`, `mounts`, `containerEnv`, array/object `postCreateCommand`, …) is ignored, and Atlas shows a note listing
what it ignored. There is no `start`, `env` or mounts from this source. Like `container.json`, it is parsed as JSONC,
so comments and trailing commas are fine.

## Dockerfiles

A Dockerfile is the escape hatch: naming an image in `container.json` starts faster and cannot break on a build.
There are two ways to use one. `"dockerfile": "Dockerfile"` (any path inside `.atlas/`) in `container.json` builds
it and still applies that file's `setup`, `start`, `env` and `mounts`. A bare `.atlas/Dockerfile` with no
`container.json` is used on its own, with no scripts, env or mounts. The image is built through the Docker daemon and tagged `atlas-dockerfile:<12-hex content hash>`.
The hash covers every file in the context (names, types, symlink targets, bytes; `.git` is skipped), so any edit
to the Dockerfile or a file beside it rebuilds, and an unchanged context reuses the existing image. A changed hash
also recreates a running sandbox. `.atlas/Dockerfile` ships the entire `.atlas/` directory as context (keep it
small, and `COPY` paths are relative to `.atlas/`); the Atlas-home Dockerfile ships only itself, so it cannot `COPY`
anything. Both `.atlas/` forms build with the whole `.atlas/` directory as context. A `dockerfile` that is absolute,
escapes `.atlas/`, is set together with `image`, or does not exist is refused and resolution falls through.
Basing the Dockerfile on the default Atlas image (`FROM ghcr.io/dennisofficial/atlas-sandbox:latest`) is the
safe starting point, since that image bakes the toolchain.

## Warnings you may see

Shown as notices (refusals as warnings) when the sandbox is anchored:

- `… is not valid JSON` / a schema error such as `image: Invalid input` or an unrecognised key: the whole file was
  refused; the next source in the order is used.
- `mount "…" is not an absolute host path` / `contains a ".." component` / `over the 512 limit` / `targets a
  reserved container path`: that one mount was dropped.
- `ignored features, … — only image and postCreateCommand are read from a devcontainer.json`.
- `carried neither image nor postCreateCommand, so it configures nothing`: devcontainer.json had nothing usable.
- `building this Dockerfile is the escape hatch …`: a Dockerfile source was chosen.
- `recreated <sandbox>: <the declared mounts | image | env | launch config> changed …`.
- `the start command exited N …`, or a setup failure that blocks start (see above).

## Where it applies

Local Docker (`/container docker`) applies everything above, from the directory the session is anchored to (the
repo or worktree root). The host (`/container off`) reads none of it.

Cloud (Vercel) sandboxes, whether started from Atlas Cloud web or the TUI, apply `setup`, `start` and `env` from
`.atlas/container.json` once the repo is cloned: `setup` runs once per sandbox (a failed setup retries on the next
boot), `start` runs on every boot, and `env` reaches the session's shells and services. The project's Setup script
in the Atlas Cloud project settings, when non-empty, runs in place of `setup`. A failed `setup` or `start` is shown
with the end of its output. Cloud sandboxes cannot change their image, so `image`, `dockerfile` and `mounts` are
not applied there and Atlas says so; the cloud image comes from the `sandbox.image` setting
(`ATLAS_SANDBOX_IMAGE`). devcontainer.json and bare Dockerfiles are local-Docker only.

In container mode the container is the only place to install or run things: never run installs or anything under
`node_modules` on the host, since native binaries there are built for the other platform. Reading the mounted files
from the host is fine. CPU/RAM limits come from the `container.cpus` and `container.memory` settings, not from
`container.json`.

## Recipe: set up a repo

1. Choose the lightest option: usually `{"image": "<toolchain image>"}` in `.atlas/container.json`. Prefer a
   published image over a Dockerfile.
2. Add `setup` for one-time installs (dependency install, apt packages). Keep it idempotent and non-interactive;
   it runs as root.
3. Add `start` for things needed on every bring-up (databases, `docker compose up -d`); it must not block.
4. Add `env` for container-only variables and `mounts` for sibling repos or caches outside the worktree
   (absolute host paths; `rw` only where writes are needed).
5. Commit `.atlas/container.json`. Tell the user to run `/container docker`, then check for notices; editing the
   file later takes effect when the sandbox is next started or the directory re-anchored.
6. Only if no image can do it, add `.atlas/Dockerfile` and point `"dockerfile": "Dockerfile"` at it in place of
   `image`, keeping the other fields.
