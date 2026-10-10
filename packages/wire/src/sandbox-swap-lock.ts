import type { Sandbox } from '@vercel/sandbox'

import { SERVE_HOME, SWAP_LOCK_PATH } from './serve-env.js'

/**
 * The wait must exceed the slowest legitimate swap (download a few MB + stop + boot + the health
 * wait, which alone can take up to ~180s on a serve that struggles to come up) or a slow winner
 * reads to the loser as a wedged one and the loser fails a swap that was about to free the lock.
 */
export const SWAP_LOCK_TIMEOUT_SECONDS = 300

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
 * A non-detached `runCommand` promise resolves when its shell exits, and flock drops the fd the
 * moment that shell dies — so an acquire-then-work lease across two commands releases before the
 * work starts (proven live 2026-10-10: a contender takes the lock the instant the acquirer's
 * runCommand returns). The lease below holds the lock in a DETACHED process that blocks on a
 * release marker; killing it (or letting it see the marker) exits the shell and drops fd 9.
 */
const HOLDER_SCRIPT = (args: {
  heldMarker: string
  failMarker: string
  releaseMarker: string
  waitSeconds: number
}) =>
  `mkdir -p ${SERVE_HOME} && rm -f ${args.heldMarker} ${args.failMarker} ${args.releaseMarker} && ` +
  `exec 9> ${SWAP_LOCK_PATH} && ` +
  `if flock -w ${args.waitSeconds} 9; then ` +
  `: > ${args.heldMarker}; ` +
  `while [ ! -f ${args.releaseMarker} ]; do sleep 0.2; done; ` +
  `else echo $? > ${args.failMarker}; fi`

export type SwapLease = { release: () => Promise<void> }

const ACQUIRE_POLL_MS = 200

let leaseSequence = 0

export const acquireSwapLock = async (args: {
  sandbox: Sandbox
  sh: SandboxSh
  /** Overrides the bounded wait — a spec passes a small value so a busy lock fails fast. */
  waitSeconds?: number
}): Promise<SwapLease> => {
  const waitSeconds = args.waitSeconds ?? SWAP_LOCK_TIMEOUT_SECONDS
  // pid alone is not unique: two sequential leases in one process would share marker paths, and
  // the first lease's leftover release-marker would release the second's holder instantly.
  leaseSequence += 1
  const leaseId = `${process.pid}.${leaseSequence}`
  const heldMarker = `${SWAP_LOCK_PATH}.held.${leaseId}`
  const failMarker = `${SWAP_LOCK_PATH}.fail.${leaseId}`
  const releaseMarker = `${SWAP_LOCK_PATH}.release.${leaseId}`
  const holder = await args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', HOLDER_SCRIPT({ heldMarker, failMarker, releaseMarker, waitSeconds })],
    detached: true,
  })
  // The holder acquires asynchronously; the kernel flock means only one holder's held-marker can
  // exist at a time, so seeing OUR marker proves THIS lease holds the lock. A fail-marker with
  // flock's exit code distinguishes a busy-timeout (1) from a broken lock path (anything else).
  // Bounded by the same wait the holder allows itself, so a wedged predecessor fails classified
  // rather than blocking the wake forever.
  const deadline = Date.now() + (waitSeconds + 15) * 1000
  let acquired = false
  let busy = false
  while (Date.now() < deadline) {
    const probe = await args
      .sh({
        sandbox: args.sandbox,
        script:
          `if [ -f ${failMarker} ]; then echo FAIL:$(cat ${failMarker}); ` +
          `elif [ -f ${heldMarker} ]; then echo HELD; else echo WAIT; fi`,
        timeoutMs: 10_000,
      })
      .catch(() => null)
    const state = probe === null ? 'WAIT' : (await probe.stdout()).trim()
    if (state === 'HELD') {
      acquired = true
      break
    }
    if (state.startsWith('FAIL:')) {
      busy = state === 'FAIL:1'
      break
    }
    await new Promise((resolve) => setTimeout(resolve, ACQUIRE_POLL_MS))
  }
  if (!acquired) {
    await args
      .sh({ sandbox: args.sandbox, script: `rm -f ${heldMarker} ${failMarker} ${releaseMarker}`, timeoutMs: 10_000 })
      .catch(() => null)
    await holder.kill().catch(() => null)
    if (busy) {
      throw new Error(
        `sandbox ${args.sandbox.name}'s swap lock stayed busy for ${waitSeconds}s — another wake is mid-swap there; the sandbox was preserved untouched`,
      )
    }
    throw new Error(
      `sandbox ${args.sandbox.name}'s swap lock holder never acquired the lock — the sandbox was preserved untouched`,
    )
  }
  let held = true
  return {
    release: async () => {
      if (!held) return
      held = false
      // Mark the release so the holder's loop exits on its own; kill as backstop in case the shell
      // is wedged. Either path drops fd 9. The held-marker is removed so a later acquirer cannot
      // read a stale one as its own.
      await args
        .sh({ sandbox: args.sandbox, script: `touch ${releaseMarker}`, timeoutMs: 10_000 })
        .catch(() => null)
      await holder.kill().catch(() => null)
      // Remove this lease's markers so they do not accumulate in the sandbox across wakes.
      await args
        .sh({ sandbox: args.sandbox, script: `rm -f ${heldMarker} ${releaseMarker}`, timeoutMs: 10_000 })
        .catch(() => null)
    },
  }
}

export const withSwapLock = async <T>(args: {
  sandbox: Sandbox
  sh: SandboxSh
  run: () => Promise<T>
  waitSeconds?: number
}): Promise<T> => {
  const lease = await acquireSwapLock({
    sandbox: args.sandbox,
    sh: args.sh,
    ...(args.waitSeconds === undefined ? {} : { waitSeconds: args.waitSeconds }),
  })
  try {
    return await args.run()
  } finally {
    await lease.release()
  }
}
