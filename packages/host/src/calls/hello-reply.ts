import { actionForAnswer, needsRun } from './errors'
import type { CallLane } from './call-open'
import { interruptedResult, type Pending } from './remote-calls-frames'

export const handleHello = (lane: CallLane, frame: { bootId: string; version: string }): void => {
  const previousBootId = lane.bootId()
  const restart = previousBootId !== undefined && previousBootId !== frame.bootId
  lane.arrived(frame)
  const flushedAcks = lane.flushAcks()
  if (previousBootId !== undefined) {
    lane.logged({ restart, flushedAcks, pending: lane.listed().length })
  }
  if (restart) recoverAcrossRestart({ lane, previousBootId })
  lane.helloReady({ bootId: frame.bootId, restart })
  for (const call of lane.listed()) {
    if (call.done || call.awaitingAnswer || !call.armed) continue
    lane.sendRun(call)
  }
  lane.schedulePing()
}

const recoverAcrossRestart = (args: { lane: CallLane; previousBootId: string }): void => {
  for (const call of args.lane.listed()) {
    if (call.done || !call.sent) continue
    void recover({ lane: args.lane, call, previousBootId: args.previousBootId })
  }
}

const recover = async (args: {
  lane: CallLane
  call: Pending
  previousBootId: string
}): Promise<void> => {
  const { lane, call } = args
  call.awaitingAnswer = true
  const answer = await lane.answers.ask(call.key)
  call.awaitingAnswer = false
  if (call.done || lane.gone()) return
  const action = actionForAnswer({
    op: call.op.op,
    dispatchedBootId: args.previousBootId,
    currentBootId: lane.bootId(),
    answer,
  })
  if (action.type === 'wait') return
  if (!needsRun(action)) {
    lane.settle(call, interruptedResult(call.op.op))
    return
  }
  if (action.type === 'rerun') call.delivered = 0
  if (lane.linkReady()) lane.sendRun(call)
}
