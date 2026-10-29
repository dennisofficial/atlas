import type { ThreadListFrame, ThreadStreamFrame } from '@dltech/atlas-wire'
import { DrainStateService } from '../health/drain-state.service'
import { ThreadSignalsService } from './thread-signals.service'

export function recordingSignals(): {
  signals: ThreadSignalsService
  framesOf: (threadId: string) => ThreadStreamFrame[]
  listFramesOf: (userId: string) => ThreadListFrame[]
} {
  const signals = new ThreadSignalsService(new DrainStateService())
  const seen = new Map<string, ThreadStreamFrame[]>()
  const framesOf = (threadId: string): ThreadStreamFrame[] => {
    const known = seen.get(threadId)
    if (known !== undefined) return known
    const frames: ThreadStreamFrame[] = []
    seen.set(threadId, frames)
    signals.openStream({ threadId, onFrame: (frame) => frames.push(frame) })
    return frames
  }
  const listSeen = new Map<string, ThreadListFrame[]>()
  const listFramesOf = (userId: string): ThreadListFrame[] => {
    const known = listSeen.get(userId)
    if (known !== undefined) return known
    const frames: ThreadListFrame[] = []
    listSeen.set(userId, frames)
    signals.openListStream({ userId, onFrame: (frame) => frames.push(frame) })
    return frames
  }
  return { signals, framesOf, listFramesOf }
}

export const inertSignals = (): ThreadSignalsService => recordingSignals().signals
