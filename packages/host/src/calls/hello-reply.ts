import { decideCall } from './call-decide'
import type { CallLane } from './call-open'

export const handleHello = (lane: CallLane, frame: { bootId: string; version: string }): void => {
  const previousBootId = lane.bootId()
  const restart = previousBootId !== undefined && previousBootId !== frame.bootId
  lane.arrived(frame)
  const flushedAcks = lane.flushAcks()
  if (previousBootId !== undefined) {
    lane.logged({ restart, flushedAcks, pending: lane.listed().length })
  }
  if (restart) recoverAcrossRestart(lane)
  lane.helloReady({ bootId: frame.bootId, restart })
  for (const call of lane.listed()) {
    if (call.done || call.awaitingAnswer) continue
    if (call.waiting) {
      void decideCall({ lane, call })
      continue
    }
    if (!call.armed) continue
    lane.sendRun(call)
  }
  lane.schedulePing()
}

const recoverAcrossRestart = (lane: CallLane): void => {
  for (const call of lane.listed()) {
    if (call.done || !call.sent) continue
    void decideCall({ lane, call })
  }
}
