import type { Event } from '@dltech/atlas-core'
import type { StepSignal } from '@dltech/atlas-client/channel'

import { stepsOfSignals, tailRunOfSteps, type TailRun } from '@dltech/atlas-client/transcript'

export {
  advancedGate,
  attachedGate,
  FRAME_MS,
  gateIsDraining,
  type TailRun,
} from '@dltech/atlas-client/transcript'

export const tailRunOf = (args: {
  events: readonly Event[]
  signals: readonly StepSignal[]
}): TailRun | null => tailRunOfSteps({ steps: stepsOfSignals(args.signals), events: args.events })
