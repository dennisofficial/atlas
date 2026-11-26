import { attachRecordedCall, decideCall } from './call-decide'
import type { CallLane } from './call-open'

export const handleHello = (lane: CallLane, frame: { bootId: string; version: string }): void => {
  const previousBootId = lane.bootId()
  const restart = previousBootId !== undefined && previousBootId !== frame.bootId
  lane.arrived(frame)
  const flushedAcks = lane.flushAcks()
  lane.flushCancels(frame.bootId)
  if (previousBootId !== undefined) {
    lane.logged({ restart, flushedAcks, pending: lane.listed().length })
  }
  if (restart) recoverAcrossRestart({ lane, previousBootId })
  lane.helloReady({ bootId: frame.bootId, restart })
  for (const call of lane.listed()) {
    if (call.done || call.awaitingAnswer) continue
    if (call.waiting) {
      if (call.attachOnly === true) void attachRecordedCall({ lane, call })
      else void decideCall({ lane, call })
      continue
    }
    if (!call.armed) continue
    lane.sendRun(call)
  }
  lane.schedulePing()
}

const recoverAcrossRestart = (args: { lane: CallLane; previousBootId: string }): void => {
  for (const call of args.lane.listed()) {
    if (call.done || !call.sent) continue
    void decideCall({ lane: args.lane, call, dispatchedBootId: args.previousBootId })
  }
}
