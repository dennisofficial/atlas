import type { PauseSignal } from '@dltech/atlas-agent'
import type { LogPort } from '@dltech/atlas-observability'

import { DRAIN_STREAM_ABORT_CAP_MS } from '../drain-cap'
import type { HostTimers } from '../ports'
import { settledWithin } from './child-turns'

export const drainChildTurn = async (args: {
  timers: HostTimers
  drainCapMs: number
  agentId: string
  pause: PauseSignal
  done: Promise<void>
  log?: LogPort | undefined
}): Promise<void> => {
  const settled = await settledWithin({
    timers: args.timers,
    ms: args.drainCapMs,
    done: args.done,
  })
  if (settled) return
  args.log?.warn({
    source: 'holder.drain',
    message: `sub-agent ${args.agentId} ran in flight for ${args.drainCapMs}ms, past the drain cap; aborting its model stream`,
  })
  args.pause.abortModelStep()
  const aborted = await settledWithin({
    timers: args.timers,
    ms: DRAIN_STREAM_ABORT_CAP_MS,
    done: args.done,
  })
  if (aborted) return
  args.log?.warn({
    source: 'holder.drain',
    message: `sub-agent ${args.agentId} kept its model stream ${DRAIN_STREAM_ABORT_CAP_MS}ms past its abort; handing off without it`,
  })
}
