import { EDaemonAnswer } from './call-states'

export type CallRecordFacts = {
  dispatched: boolean
  dispatchedBootId: string | undefined
  resultRecorded: boolean
  readOnly: boolean
}

export type RecoverAction =
  | { type: 'ack' }
  | { type: 'record-result' }
  | { type: 'attach' }
  | { type: 'run' }
  | { type: 'rerun' }
  | { type: 'interrupted' }

export type RecoverVariant = {
  rerunAcrossBoot?: boolean
  doneRuns?: boolean
  recordedRecords?: boolean
}

export function recoverCall(args: {
  facts: CallRecordFacts
  answer: EDaemonAnswer
  bootId: string
  variant?: RecoverVariant | undefined
}): RecoverAction {
  const { facts, answer, bootId, variant } = args

  if (facts.resultRecorded) {
    return variant?.recordedRecords === true ? { type: 'record-result' } : { type: 'ack' }
  }
  if (answer === EDaemonAnswer.Done) {
    return variant?.doneRuns === true ? { type: 'run' } : { type: 'record-result' }
  }
  if (answer === EDaemonAnswer.Running) return { type: 'attach' }

  const sameBoot = facts.dispatchedBootId === bootId
  if (facts.dispatched && facts.dispatchedBootId !== undefined && sameBoot) return { type: 'run' }
  if (facts.dispatched && !sameBoot) {
    if (facts.readOnly || variant?.rerunAcrossBoot === true) return { type: 'rerun' }
    return { type: 'interrupted' }
  }
  return { type: 'interrupted' }
}
