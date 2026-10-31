import { EThreadListFrame, type ThreadListFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import type { ListSignal, ThreadChangedSignal } from './thread-signal.bus'

export type OpenStream = {
  onFrame: (frame: ThreadStreamFrame) => void
  onClosed: (() => void) | undefined
}

export function registerFrameStream<TFrame>(args: {
  streams: Map<
    string,
    Set<{ onFrame: (frame: TFrame) => void; onClosed: (() => void) | undefined }>
  >
  key: string
  onFrame: (frame: TFrame) => void
  onClosed?: () => void
}): () => void {
  const entry = { onFrame: args.onFrame, onClosed: args.onClosed }
  const entries = args.streams.get(args.key) ?? new Set<typeof entry>()
  args.streams.set(args.key, entries)
  entries.add(entry)
  return () => {
    entries.delete(entry)
    if (entries.size === 0) args.streams.delete(args.key)
  }
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
