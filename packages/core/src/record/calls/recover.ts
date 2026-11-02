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

export function recoverCall(args: {
  facts: CallRecordFacts
  answer: EDaemonAnswer
  bootId: string
}): RecoverAction {
  const { facts, answer, bootId } = args

  if (facts.resultRecorded) return { type: 'ack' }
  if (answer === EDaemonAnswer.Done) return { type: 'record-result' }
  if (answer === EDaemonAnswer.Running) return { type: 'attach' }

  const sameBoot = facts.dispatchedBootId === bootId
  if (facts.dispatched && facts.dispatchedBootId !== undefined && sameBoot) return { type: 'run' }
  if (facts.dispatched && !sameBoot && facts.readOnly) return { type: 'rerun' }
  return { type: 'interrupted' }
}
