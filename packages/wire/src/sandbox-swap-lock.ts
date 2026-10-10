import type { Sandbox } from '@vercel/sandbox'

import { SERVE_HOME, SWAP_LOCK_PATH } from './serve-env.js'

export const SWAP_LOCK_TIMEOUT_SECONDS = 180

export type SandboxSh = (args: {
  sandbox: Sandbox
  script: string
  timeoutMs?: number
  env?: Record<string, string>
}) => ReturnType<Sandbox['runCommand']>

export const sandboxSh: SandboxSh = (args) =>
  args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', args.script],
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.env === undefined ? {} : { env: args.env }),
  })

/**
 * flock's exit contract: 0 acquired, 1 timed out on `-w`, anything else is a broken lock path and
 * is refused with stderr verbatim so a wrapper mistake never reads as contention.
 */
const ACQUIRE_SCRIPT =
  `mkdir -p ${SERVE_HOME} && ` +
  `exec 9> ${SWAP_LOCK_PATH} && ` +
  `flock -w ${SWAP_LOCK_TIMEOUT_SECONDS} 9`

const RELEASE_SCRIPT = `exec 9> ${SWAP_LOCK_PATH} && flock -u 9`

export type SwapLease = { release: () => Promise<void> }

export const acquireSwapLock = async (args: {
  sandbox: Sandbox
  sh: SandboxSh
}): Promise<SwapLease> => {
  const acquire = await args.sh({
    sandbox: args.sandbox,
    script: ACQUIRE_SCRIPT,
    timeoutMs: (SWAP_LOCK_TIMEOUT_SECONDS + 15) * 1000,
  })
  if (acquire.exitCode === 1) {
    throw new Error(
      `sandbox ${args.sandbox.name}'s swap lock stayed busy for ${SWAP_LOCK_TIMEOUT_SECONDS}s — another wake is mid-swap there; the sandbox was preserved untouched`,
    )
  }
  if (acquire.exitCode !== 0) {
    const stderr =
      typeof acquire.stderr === 'function' ? (await acquire.stderr()).trim() : ''
    throw new Error(
      `sandbox ${args.sandbox.name}'s swap lock could not be taken (flock exit ${acquire.exitCode})${stderr === '' ? '' : `: ${stderr}`} — the sandbox was preserved untouched`,
    )
  }
  let held = true
  return {
    release: async () => {
      if (!held) return
      held = false
      await args
        .sh({ sandbox: args.sandbox, script: RELEASE_SCRIPT, timeoutMs: 15_000 })
        .catch(() => null)
    },
  }
}

export const withSwapLock = async <T>(args: {
  sandbox: Sandbox
  sh: SandboxSh
  run: () => Promise<T>
}): Promise<T> => {
  const lease = await acquireSwapLock({ sandbox: args.sandbox, sh: args.sh })
  try {
    return await args.run()
  } finally {
    await lease.release()
  }
}
