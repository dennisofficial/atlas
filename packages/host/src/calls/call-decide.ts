import type { CallLane } from './call-open'
import { actionForAnswer, needsRun } from './errors'
import { interruptedResult, type Pending } from './remote-calls-frames'

export const decideCall = async (args: { lane: CallLane; call: Pending }): Promise<void> => {
  const { lane, call } = args
  if (call.done || call.awaitingAnswer) return
  call.awaitingAnswer = true
  const answer = await lane.answers.ask(call.key)
  call.awaitingAnswer = false
  if (call.done || lane.gone()) return
  if (settleAborted({ lane, call })) return
  const action = actionForAnswer({
    op: call.op.op,
    dispatchedBootId: call.dispatchBootId,
    currentBootId: lane.bootId(),
    answer,
  })
  if (action.type === 'wait') {
    call.waiting = true
    return
  }
  call.waiting = false
  if (!needsRun(action)) {
    lane.settle(call, interruptedResult(call.op.op))
    return
  }
  if (action.type === 'rerun') call.delivered = 0
  call.armed = true
  if (lane.linkReady()) lane.sendRun(call)
}

export const attachRecordedCall = async (args: {
  lane: CallLane
  call: Pending
}): Promise<void> => {
  const { lane, call } = args
  call.awaitingAnswer = true
  const answer = await lane.answers.ask(call.key)
  call.awaitingAnswer = false
  if (call.done || lane.gone()) return
  if (settleAborted({ lane, call })) return
  if (answer === 'unavailable') {
    call.waiting = true
    return
  }
  if (answer !== 'running' && answer !== 'done') {
    lane.settle(call, interruptedResult(call.op.op))
    return
  }
  call.armed = true
  if (lane.linkReady()) lane.sendRun(call)
}

const settleAborted = (args: { lane: CallLane; call: Pending }): boolean => {
  if (!args.call.controller.signal.aborted) return false
  args.lane.settle(args.call, interruptedResult(args.call.op.op))
  return true
}
