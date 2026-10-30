import { ERunFailureKind, type RunFailure, type RunId } from '@dltech/atlas-core'

import { EStepEnd } from '../channel'

import type { InFlightStep } from './in-flight-steps'
import type { DurableRunFailure } from './run-failure'

export type PickedFailure = {
  failure: RunFailure | null
  message: string | null
  failureSeq: number | null
  runId: RunId | null
}

export const failureKindOf = (picked: PickedFailure): ERunFailureKind =>
  picked.failure?.kind ?? ERunFailureKind.Other

export function pickFailure(args: {
  steps: readonly InFlightStep[]
  durable: DurableRunFailure | null
  legacy: { message: string; seq: number | null } | null
  streaming: boolean
}): PickedFailure | null {
  if (args.steps.some((step) => step.end !== EStepEnd.Failed)) return null
  const { durable } = args
  if (durable !== null) {
    return {
      failure: durable.failure,
      message: durable.failure.message,
      failureSeq: durable.seq ?? null,
      runId: durable.runId,
    }
  }
  const failed = args.steps.filter((step) => step.end === EStepEnd.Failed).at(-1)
  if (failed !== undefined) {
    return { failure: null, message: failed.errorMessage, failureSeq: null, runId: null }
  }
  if (args.streaming || args.legacy === null) return null
  return { failure: null, message: args.legacy.message, failureSeq: args.legacy.seq, runId: null }
}
