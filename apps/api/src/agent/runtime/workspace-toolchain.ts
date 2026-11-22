import { run } from './workspace-git'
import { fail, report, type Deps } from './workspace-state'

const TOOLCHAIN_TIMEOUT_MS = 5 * 60_000
const TOOLCHAIN_OUTPUT_TAIL_CHARS = 4000
const MISE_INSTALL = 'command -v mise >/dev/null 2>&1 || exit 0; mise install'

/**
 * Installs the versions a repository pins (mise.toml, .tool-versions, .bun-version, .nvmrc)
 * before its setup script runs: the image bakes one version of each tool and mise is configured
 * not to auto-install, so a pin would otherwise be missing. Best effort by design — a sandbox
 * whose mise cannot reach the network must not cost the session its setup script.
 */
export const installToolchain = async (args: {
  deps: Deps
  launchDirectory: string
  scrub: (text: string) => string
}): Promise<boolean> => {
  const outcome = await run({
    processes: args.deps.processes,
    cmd: ['sh', '-c', MISE_INSTALL],
    cwd: args.launchDirectory,
    timeoutMs: TOOLCHAIN_TIMEOUT_MS,
    ...(args.deps.signal === undefined ? {} : { signal: args.deps.signal }),
    env: { ...args.deps.env, MISE_YES: '1' },
  })
  if (outcome.ok) return true
  const detail = args.scrub(outcome.output).trim().slice(-TOOLCHAIN_OUTPUT_TAIL_CHARS)
  const message = outcome.interrupted
    ? 'toolchain install was interrupted'
    : 'toolchain install failed (command: mise install)'
  report({ deps: args.deps, message, detail })
  fail({ deps: args.deps, message, detail })
  return false
}
