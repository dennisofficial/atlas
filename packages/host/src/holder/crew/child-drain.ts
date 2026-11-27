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
  if (!args.pause.stepSettling) return
  const settled = await settledWithin({
    timers: args.timers,
    ms: args.drainCapMs,
    done: args.pause.whenStepSettled(),
  })
  if (settled) return
  args.log?.warn({
    source: 'holder.drain',
    message: `sub-agent ${args.agentId} ran the model stream for ${args.drainCapMs}ms, past the drain cap; aborting it`,
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
    message: `sub-agent ${args.agentId} kept its turn ${DRAIN_STREAM_ABORT_CAP_MS}ms past its aborted stream; handing off without it`,
  })
}
