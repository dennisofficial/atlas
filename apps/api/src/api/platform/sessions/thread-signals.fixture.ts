import type { ThreadStreamFrame } from '@dltech/atlas-wire'
import { DrainStateService } from '../health/drain-state.service'
import { ThreadSignalsService } from './thread-signals.service'

export function recordingSignals(): {
  signals: ThreadSignalsService
  framesOf: (threadId: string) => ThreadStreamFrame[]
  changedThreads: string[]
} {
  const signals = new ThreadSignalsService(new DrainStateService())
  const changedThreads: string[] = []
  signals.threadChanged = (args) => {
    changedThreads.push(args.threadId)
  }
  const seen = new Map<string, ThreadStreamFrame[]>()
  const framesOf = (threadId: string): ThreadStreamFrame[] => {
    const known = seen.get(threadId)
    if (known !== undefined) return known
    const frames: ThreadStreamFrame[] = []
    seen.set(threadId, frames)
    signals.openStream({ threadId, onFrame: (frame) => frames.push(frame) })
    return frames
  }
  return { signals, framesOf, changedThreads }
}

export const inertSignals = (): ThreadSignalsService => recordingSignals().signals
