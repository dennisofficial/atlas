import { startVerdict, type Lease } from '@dltech/atlas-core'

import type { HeldSessionDeps } from './held-session'
import { SESSION_HOLDER_DEFAULTS as DEFAULTS, type SessionHolderArgs } from './session-holder-args'

export type HeldDepsArgs = {
  args: SessionHolderArgs
  onRuntimeReady: (sessionId: string) => void
  lease: Lease
  podSessionId: string
}

export const heldSessionDepsOf = (args: HeldDepsArgs): HeldSessionDeps => {
  const { args: holder } = args
  const isPermanentStartError = holder.isPermanentStartError ?? (() => false)
  return {
    sessionId: args.lease.sessionId,
    podSessionId: args.podSessionId,
    podPeers: holder.podPeers,
    plane: holder.plane,
    bus: holder.bus,
    timers: holder.timers,
    ids: holder.ids,
    appendRetryMs: holder.appendRetryMs ?? DEFAULTS.appendRetryMs,
    runtimeFor: holder.runtimes,
    judgeStartFailure: (error) =>
      startVerdict({
        attempts: args.lease.attempts,
        permanent: isPermanentStartError(error),
      }),
    reasonOfStartError: holder.reasonOfStartError,
    commands: holder.commands,
    commandHandlers: holder.commandHandlers,
    controlHandlers: holder.controlHandlers,
    control: holder.control,
    mcp: holder.mcp,
    changes: holder.changes,
    notify: holder.notify,
    turnEnded: holder.turnEnded,
    onRuntimeReady: () => args.onRuntimeReady(args.lease.sessionId),
    ...(holder.operator === undefined
      ? {}
      : {
          operator: {
            sessionDir: holder.operator.sessionDir(args.lease.sessionId),
            openValue: holder.operator.openValue,
          },
        }),
    log: holder.log,
  }
}
