import { setTimeout as sleep } from 'node:timers/promises'
import {
  isSandboxMissing,
  SANDBOX_QUICK_TIMEOUT_MS,
  SANDBOX_SERVE_PORT,
  type VercelCredentials,
  type VercelSdk,
} from '@dltech/atlas-wire'
import type { Sandbox } from '@vercel/sandbox'
import { failureText } from '../github/github-sandbox-wake-boot'
import {
  PARK_NOTIFY_TIMEOUT_MS,
  parkNoticeScript,
} from '../../platform/sandboxes/vercel-sandbox.client'

export const RESIZE_PARK_REASON = 'the sandbox is restarting to apply a new size'

const SETTLED_STATUSES: ReadonlySet<string> = new Set(['stopped', 'failed', 'aborted'])

export type ResizeRestartTiming = { pollMs: number; graceMs: number; forceMs: number }

export const RESIZE_RESTART_TIMING: ResizeRestartTiming = {
  pollMs: 2_000,
  graceMs: 45_000,
  forceMs: 60_000,
}

export type RestartTarget = { sdk: VercelSdk; credentials: VercelCredentials; name: string }

export async function sandboxOf(target: RestartTarget): Promise<Sandbox | undefined> {
  try {
    return await target.sdk.get({
      ...target.credentials,
      name: target.name,
      resume: false,
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
  } catch (failure) {
    if (isSandboxMissing(failure)) return undefined
    throw failure
  }
}

export const settled = (sandbox: Sandbox | undefined): boolean =>
  sandbox === undefined || SETTLED_STATUSES.has(sandbox.status)

export async function settlesWithin(args: {
  target: RestartTarget
  withinMs: number
  pollMs: number
}): Promise<boolean> {
  const deadline = Date.now() + args.withinMs
  while (Date.now() < deadline) {
    await sleep(args.pollMs)
    if (settled(await sandboxOf(args.target))) return true
  }
  return false
}

async function askServeToPark(args: { sandbox: Sandbox; log: (line: string) => void }) {
  try {
    await args.sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', parkNoticeScript(SANDBOX_SERVE_PORT)],
      env: { ATLAS_PARK_REASON: JSON.stringify({ reason: RESIZE_PARK_REASON }) },
      timeoutMs: PARK_NOTIFY_TIMEOUT_MS,
    })
  } catch (failure) {
    args.log(`could not ask serve to park before the resize: ${failureText(failure)}`)
  }
}

/**
 * Saves the new size and brings the sandbox to a fully stopped session, so the wake that follows
 * resumes at that size instead of racing a stop still in flight (Vercel answers `sandbox_stopping`).
 */
export async function restartForResize(
  args: RestartTarget & {
    vcpus: number
    log: (line: string) => void
    timing?: ResizeRestartTiming | undefined
  },
): Promise<void> {
  const timing = args.timing ?? RESIZE_RESTART_TIMING
  const target = { sdk: args.sdk, credentials: args.credentials, name: args.name }
  const sandbox = await sandboxOf(target)
  if (sandbox === undefined) return
  await sandbox.update(
    { resources: { vcpus: args.vcpus } },
    { signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) },
  )
  if (settled(sandbox)) return
  await askServeToPark({ sandbox, log: args.log })
  if (await settlesWithin({ target, withinMs: timing.graceMs, pollMs: timing.pollMs })) return
  args.log(`sandbox ${args.name} did not park itself for the resize; stopping it`)
  const current = await sandboxOf(target)
  if (current === undefined || settled(current)) return
  await current.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
  if (await settlesWithin({ target, withinMs: timing.forceMs, pollMs: timing.pollMs })) return
  throw new Error(`sandbox ${args.name} did not stop for the resize`)
}
