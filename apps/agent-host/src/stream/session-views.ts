import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { SessionChange, SessionViewOutput, StreamServerMessage } from '@dltech/atlas-protocol'

import { viewFrameOf } from './view-frame'

export const VIEW_COALESCE_MS = 250

export type ViewReader = (args: {
  sessionId: string
  threadId: string
}) => Promise<SessionViewOutput>

export type ViewWatcher = {
  readonly id: string
  readonly sessionId: string
  readonly threadId: string | undefined
  readonly protocolVersion: number
  send(message: StreamServerMessage): void
}

type Entry = {
  threadId: string
  watchers: Map<ViewWatcher, string | undefined>
  last: SessionViewOutput | undefined
  running: boolean
  dirty: boolean
  lastRunAt: number | undefined
  timer: unknown
}

export class SessionViews {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly args: {
      read: ViewReader
      timers: HostTimers
      log: LogPort | undefined
      onLiveness?: (args: { sessionId: string; live: boolean }) => void
    },
  ) {}

  add(watcher: ViewWatcher): void {
    const { threadId } = watcher
    if (threadId === undefined) return
    const existing = this.entries.get(watcher.sessionId)
    const entry = existing ?? this.created({ sessionId: watcher.sessionId, threadId })
    entry.watchers.set(watcher, undefined)
    if (existing === undefined) {
      this.request({ sessionId: watcher.sessionId, entry })
      return
    }
    if (entry.last !== undefined) this.deliver({ watcher, entry, view: entry.last })
  }

  remove(watcher: ViewWatcher): void {
    const entry = this.entries.get(watcher.sessionId)
    if (entry === undefined) return
    entry.watchers.delete(watcher)
    if (entry.watchers.size > 0) return
    if (entry.timer !== undefined) this.args.timers.clearTimeout(entry.timer)
    this.entries.delete(watcher.sessionId)
  }

  handleChange(change: SessionChange): void {
    const entry = this.entries.get(change.sessionId)
    if (entry === undefined) return
    if (change.threadId !== undefined && change.threadId !== entry.threadId) return
    if (
      change.headSeq !== undefined &&
      entry.last !== undefined &&
      change.headSeq <= entry.last.at
    ) {
      return
    }
    this.request({ sessionId: change.sessionId, entry })
  }

  recheck(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (entry !== undefined) this.request({ sessionId, entry })
  }

  refreshAll(): void {
    for (const [sessionId, entry] of this.entries) this.request({ sessionId, entry })
  }

  close(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer !== undefined) this.args.timers.clearTimeout(entry.timer)
    }
    this.entries.clear()
  }

  private created(args: { sessionId: string; threadId: string }): Entry {
    const entry: Entry = {
      threadId: args.threadId,
      watchers: new Map(),
      last: undefined,
      running: false,
      dirty: false,
      lastRunAt: undefined,
      timer: undefined,
    }
    this.entries.set(args.sessionId, entry)
    return entry
  }

  private request(args: { sessionId: string; entry: Entry }): void {
    const { entry } = args
    if (entry.running) {
      entry.dirty = true
      return
    }
    if (entry.timer !== undefined) return
    const { timers } = this.args
    const dueIn =
      entry.lastRunAt === undefined ? 0 : entry.lastRunAt + VIEW_COALESCE_MS - timers.now()
    if (dueIn <= 0) {
      void this.run(args)
      return
    }
    entry.timer = timers.setTimeout(() => {
      entry.timer = undefined
      void this.run(args)
    }, dueIn)
  }

  private async run(args: { sessionId: string; entry: Entry }): Promise<void> {
    const { sessionId, entry } = args
    entry.running = true
    entry.dirty = false
    entry.lastRunAt = this.args.timers.now()
    try {
      const view = await this.args.read({ sessionId, threadId: entry.threadId })
      if (this.entries.get(sessionId) !== entry) return
      entry.last = view
      for (const watcher of [...entry.watchers.keys()]) this.deliver({ watcher, entry, view })
      this.args.onLiveness?.({ sessionId, live: view.status.lease.live })
    } catch (error) {
      this.args.log?.error({
        source: 'stream',
        message: `status view read failed for ${sessionId}`,
        ...logFieldsOf({ error }),
      })
    } finally {
      entry.running = false
      if (entry.dirty && this.entries.get(sessionId) === entry) this.request(args)
    }
  }

  private deliver(args: { watcher: ViewWatcher; entry: Entry; view: SessionViewOutput }): void {
    const { watcher, entry, view } = args
    const frame = viewFrameOf({ id: watcher.id, protocolVersion: watcher.protocolVersion, view })
    const signature = JSON.stringify(frame)
    if (entry.watchers.get(watcher) === signature) return
    entry.watchers.set(watcher, signature)
    watcher.send(frame)
  }
}
