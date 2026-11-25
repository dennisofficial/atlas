import { needsRun, recoveryFor } from './errors'
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
  if (restart) markForRecovery({ lane })
  retryRecoveries({ lane })
  lane.helloReady({ bootId: frame.bootId, restart })
  for (const call of lane.listed()) {
    if (call.done || call.awaitingAnswer || call.recovering || !call.armed) continue
    lane.sendRun(call)
  }
  lane.schedulePing()
}

const markForRecovery = (args: { lane: CallLane }): void => {
  for (const call of args.lane.listed()) {
    if (call.done || !call.sent) continue
    call.recovering = true
  }
}

const retryRecoveries = (args: { lane: CallLane }): void => {
  for (const call of args.lane.listed()) {
    if (call.done || !call.recovering) continue
    void recover({ lane: args.lane, call })
  }
}

const recover = async (args: { lane: CallLane; call: Pending }): Promise<void> => {
  const { lane, call } = args
  call.awaitingAnswer = true
  const answer = await lane.answers.ask(call.key)
  call.awaitingAnswer = false
  if (call.done || lane.gone()) {
    call.recovering = false
    return
  }
  const action = recoveryFor({
    op: call.op.op,
    dispatchedBootId: call.dispatchedBootId,
    currentBootId: lane.bootId(),
    answer,
  })
  if (action.type === 'wait') return
  call.recovering = false
  if (!needsRun(action)) {
    lane.settle(call, interruptedResult(call.op.op))
    return
  }
  if (action.type === 'rerun') call.delivered = 0
  if (lane.linkReady()) lane.sendRun(call)
}
