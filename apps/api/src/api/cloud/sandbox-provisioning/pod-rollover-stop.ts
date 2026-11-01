import {
  SANDBOX_QUICK_TIMEOUT_MS,
  sandboxSessionIdOf,
  type VercelCredentials,
  type VercelSdk,
} from '@dltech/atlas-wire'
import {
  RESIZE_RESTART_TIMING,
  sandboxOf,
  settled,
  settlesWithin,
  type ResizeRestartTiming,
} from './pod-resize-restart'

export async function stopSessionForRollover(args: {
  sdk: VercelSdk
  credentials: VercelCredentials
  name: string
  sessionId: string
  log: (line: string) => void
  timing?: ResizeRestartTiming | undefined
}): Promise<void> {
  const timing = args.timing ?? RESIZE_RESTART_TIMING
  const target = { sdk: args.sdk, credentials: args.credentials, name: args.name }
  const sandbox = await sandboxOf(target)
  if (sandbox === undefined || settled(sandbox)) return
  const live = sandboxSessionIdOf(sandbox)
  if (live !== args.sessionId) {
    args.log(
      `sandbox ${args.name} already moved to session ${live}; not stopping it for the rollover of ${args.sessionId}`,
    )
    return
  }
  await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
  if (await settlesWithin({ target, withinMs: timing.forceMs, pollMs: timing.pollMs })) return
  throw new Error(`sandbox ${args.name} did not stop for the rollover`)
}
