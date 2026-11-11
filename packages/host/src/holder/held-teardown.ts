import { EHeldOutcome, type HeldOutcome } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { FencedSettlement } from './fenced-settlement'
import { drainNeedsHolder } from './held-needs-holder'
import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

const readsNeedsHolder = (kind: EHeldOutcome): boolean =>
  kind === EHeldOutcome.Idle || kind === EHeldOutcome.Drained

export const teardownHeld = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime | undefined
  record: SessionRecord | undefined
  turnRunning: boolean
  kind: EHeldOutcome
  released: boolean
  epoch: number
  fenced: FencedSettlement
}): Promise<HeldOutcome> => {
  const { deps, runtime, kind } = args
  if (kind === EHeldOutcome.Fenced) {
    runtime?.remoteCalls.close()
    await args.fenced.settle(args.epoch)
    return { kind, needsHolder: false }
  }
  if (runtime !== undefined && !args.released) {
    await runtime.stop().catch((error) =>
      deps.log?.error({
        source: 'holder.settle',
        message: `stopping ${deps.sessionId} after its loop ended failed`,
        ...logFieldsOf({ error }),
      }),
    )
  }
  if (!readsNeedsHolder(kind)) return { kind, needsHolder: true }
  return {
    kind,
    needsHolder: await drainNeedsHolder({
      deps,
      record: args.record,
      turnRunning: args.turnRunning,
    }),
  }
}
