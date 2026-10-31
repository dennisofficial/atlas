import { EThreadListFrame, type ThreadListFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import type { ListSignal, ThreadChangedSignal } from './thread-signal.bus'

export type OpenStream = {
  onFrame: (frame: ThreadStreamFrame) => void
  onClosed: (() => void) | undefined
}

export type OpenListStream = {
  onFrame: (frame: ThreadListFrame) => void
  onClosed: (() => void) | undefined
}

export type OpenChangeWatch = {
  onChanged: (signal: ThreadChangedSignal) => void
}

export const listFrameOf = (signal: ListSignal): ThreadListFrame =>
  signal.activity === undefined
    ? { type: EThreadListFrame.Changed, threadId: signal.threadId }
    : { type: EThreadListFrame.Changed, threadId: signal.threadId, activity: signal.activity }
