import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { liveFrameSchema, type StreamServerMessage } from '@dltech/atlas-protocol'

import type { LiveSource } from '../live-source'
import { OverlayWatcher } from './overlay-watcher'

export type OverlayTarget = {
  readonly id: string
  readonly sessionId: string
  send(message: StreamServerMessage): void
  bufferedAmount(): number
}

type SessionEntry = { ready: Promise<void>; watchers: Map<OverlayTarget, OverlayWatcher> }

export class LiveOverlay {
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly offFrame: () => void
  private readonly offGap: () => void

  constructor(private readonly args: { source: LiveSource; log: LogPort | undefined }) {
    this.offFrame = args.source.onFrame(({ sessionId, raw }) => this.handleRaw({ sessionId, raw }))
    this.offGap = args.source.onGap(() => this.handleGap())
  }

  add(target: OverlayTarget): void {
    const entry = this.sessions.get(target.sessionId) ?? this.subscribed(target.sessionId)
    if (entry.watchers.has(target)) return
    const watcher = new OverlayWatcher({
      id: target.id,
      send: (message) => target.send(message),
      bufferedAmount: () => target.bufferedAmount(),
      readBuffer: () => this.args.source.readBuffer(target.sessionId),
      log: this.args.log,
    })
    entry.watchers.set(target, watcher)
    void entry.ready.then(() => {
      if (entry.watchers.get(target) === watcher) watcher.start()
    })
  }

  remove(target: OverlayTarget): void {
    const entry = this.sessions.get(target.sessionId)
    const watcher = entry?.watchers.get(target)
    if (entry === undefined || watcher === undefined) return
    watcher.stop()
    entry.watchers.delete(target)
    if (entry.watchers.size > 0) return
    this.sessions.delete(target.sessionId)
    this.args.source.unsubscribe(target.sessionId).catch((error: unknown) => {
      this.logError({ message: `unsubscribing ${target.sessionId} failed`, error })
    })
  }

  resnap(target: OverlayTarget): void {
    this.sessions.get(target.sessionId)?.watchers.get(target)?.resync()
  }

  holderLost(sessionId: string): void {
    for (const watcher of this.sessions.get(sessionId)?.watchers.values() ?? []) {
      watcher.holderLost()
    }
  }

  close(): void {
    this.offFrame()
    this.offGap()
    for (const entry of this.sessions.values()) {
      for (const watcher of entry.watchers.values()) watcher.stop()
    }
    this.sessions.clear()
  }

  private subscribed(sessionId: string): SessionEntry {
    const ready = this.args.source.subscribe(sessionId).catch((error: unknown) => {
      this.logError({ message: `subscribing ${sessionId} failed`, error })
    })
    const entry: SessionEntry = { ready, watchers: new Map() }
    this.sessions.set(sessionId, entry)
    return entry
  }

  private handleRaw(args: { sessionId: string; raw: string }): void {
    const entry = this.sessions.get(args.sessionId)
    if (entry === undefined) return
    const parsed = this.parse(args.raw)
    if (parsed === undefined) return
    for (const watcher of [...entry.watchers.values()]) watcher.handleFrame(parsed)
  }

  private parse(raw: string) {
    try {
      const parsed = liveFrameSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
      this.logError({ message: 'dropping a malformed live frame', error: parsed.error })
    } catch (error) {
      this.logError({ message: 'dropping an unparseable live frame', error })
    }
    return undefined
  }

  private handleGap(): void {
    for (const entry of this.sessions.values()) {
      for (const watcher of entry.watchers.values()) watcher.resync()
    }
  }

  private logError(args: { message: string; error: unknown }): void {
    this.args.log?.error({
      source: 'stream',
      message: args.message,
      ...logFieldsOf({ error: args.error }),
    })
  }
}
