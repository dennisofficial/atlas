import type { ThreadId } from '@dltech/atlas-core'

import { ERotationPhase } from './rotation-port'

export type InflightRotation = {
  operationId: string
  phase: ERotationPhase
  predecessor: ThreadId
  successor: ThreadId | undefined
  watermarkSeq: number | undefined
}

export function openInflight(args: {
  operationId: string
  predecessor: ThreadId
}): InflightRotation {
  return {
    operationId: args.operationId,
    phase: ERotationPhase.Settling,
    predecessor: args.predecessor,
    successor: undefined,
    watermarkSeq: undefined,
  }
}
