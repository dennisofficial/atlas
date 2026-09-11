# Atlas

Atlas is a coding-agent harness for the terminal — not a wrapper around someone else's harness.
The agentic loop is ours: raw LLM calls through the Vercel AI SDK, with full control over what
context the model sees, which tools it may call, when a human is asked, and what happens on
rewind. Model-agnostic by construction — Claude and Codex subscription credentials are one
provider implementation among several.

Built with OpenTUI, React, and Bun. Ships as a single compiled binary.

## Install

Download a binary from
[Releases](https://github.com/dennisofficial/atlas/releases), or run from source:

```sh
bun install
apps/tui/bin/atlas-dev
```

## Developing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the dev loop, and the PR flow. The architecture
lives in [docs/architecture.md](docs/architecture.md).
