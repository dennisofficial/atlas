<p align="center">
  <img src="assets/brand/atlas-icon.png" alt="Atlas" width="128" height="128" />
</p>

# Atlas

Atlas is a coding-agent harness for the terminal — not a wrapper around someone else's harness.
The agentic loop is ours: raw LLM calls through the Vercel AI SDK, with full control over what
context the model sees, which tools it may call, when a human is asked, and what happens on
rewind. Model-agnostic by construction — Claude and Codex subscription credentials are one
provider implementation among several.

Built with OpenTUI, React, and Bun. Ships as a single compiled binary.

## Install

```sh
curl -fsSL https://install.byatlas.io | bash
```

No GitHub auth needed — the script verifies the sha256 and puts `atlas` at `~/.local/bin`; the
binary self-updates from then on. Upgrading from a pre-1.0 install? See
[docs/upgrading.md](docs/upgrading.md) to import your old sessions. To run from source instead:

```sh
bun install
apps/tui/bin/atlas-dev
```

## Developing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the dev loop, and the PR flow. The architecture
lives in [docs/architecture.md](docs/architecture.md).
