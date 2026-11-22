import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import { liveFrameSchema, type StreamServerMessage } from '@dltech/atlas-protocol'

import type { LiveSource } from '../live-source'
import { OverlayWatcher } from './overlay-watcher'

export type OverlayTarget = {
  readonly id: string
  readonly sessionId: string
  readonly liveKey: string
  send(message: StreamServerMessage): void
  bufferedAmount(): number
}

type OverlayEntry = {
  ready: Promise<void>
  watchers: Map<OverlayTarget, OverlayWatcher>
  live: boolean
  main: boolean
}

export class LiveOverlay {
  private readonly entries = new Map<string, OverlayEntry>()
  private readonly offFrame: () => void
  private readonly offGap: () => void

  constructor(
    private readonly args: {
      source: LiveSource
      timers: HostTimers
      log: LogPort | undefined
      onFrameWhileDead?: (sessionId: string) => void
    },
  ) {
    this.offFrame = args.source.onFrame(({ key, raw }) => this.handleRaw({ key, raw }))
    this.offGap = args.source.onGap(() => this.handleGap())
  }

  add(target: OverlayTarget): void {
    const entry =
      this.entries.get(target.liveKey) ?? this.subscribed({ target, main: this.mainOf(target) })
    if (entry.watchers.has(target)) return
    const watcher = new OverlayWatcher({
      id: target.id,
      send: (message) => target.send(message),
      bufferedAmount: () => target.bufferedAmount(),
      readBuffer: () => this.args.source.readBuffer(target.liveKey),
      readShellBacklog: () => this.args.source.readShellBacklog(target.liveKey),
      timers: this.args.timers,
      log: this.args.log,
    })
    watcher.setLive(entry.live)
    entry.watchers.set(target, watcher)
    void entry.ready.then(() => {
      if (entry.watchers.get(target) === watcher) watcher.start()
    })
  }

  remove(target: OverlayTarget): void {
    const entry = this.entries.get(target.liveKey)
    const watcher = entry?.watchers.get(target)
    if (entry === undefined || watcher === undefined) return
    watcher.stop()
    entry.watchers.delete(target)
    if (entry.watchers.size > 0) return
    this.entries.delete(target.liveKey)
    this.args.source.unsubscribe(target.liveKey).catch((error: unknown) => {
      this.logError({ message: `unsubscribing ${target.liveKey} failed`, error })
    })
  }

  resnap(target: OverlayTarget): void {
    this.entries.get(target.liveKey)?.watchers.get(target)?.resync()
  }

  drained(target: OverlayTarget): void {
    this.entries.get(target.liveKey)?.watchers.get(target)?.handleDrain()
  }

  liveness(args: { sessionId: string; live: boolean }): void {
    const entry = this.entries.get(args.sessionId)
    if (entry === undefined) return
    entry.live = args.live
    for (const watcher of entry.watchers.values()) watcher.setLive(args.live)
  }

  close(): void {
    this.offFrame()
    this.offGap()
    for (const entry of this.entries.values()) {
      for (const watcher of entry.watchers.values()) watcher.stop()
    }
    this.entries.clear()
  }

  private mainOf(target: OverlayTarget): boolean {
    return target.liveKey === target.sessionId
  }

  private subscribed(spec: { target: OverlayTarget; main: boolean }): OverlayEntry {
    const liveKey = spec.target.liveKey
    const ready = this.args.source.subscribe(liveKey).catch((error: unknown) => {
      this.logError({ message: `subscribing ${liveKey} failed`, error })
    })
    const entry: OverlayEntry = {
      ready,
      watchers: new Map(),
      live: true,
      main: spec.main,
    }
    this.entries.set(liveKey, entry)
    return entry
  }

  private handleRaw(args: { key: string; raw: string }): void {
    const entry = this.entries.get(args.key)
    if (entry === undefined) return
    const parsed = this.parse(args.raw)
    if (parsed === undefined) return
    if (!entry.live && entry.main) this.args.onFrameWhileDead?.(args.key)
    const size = Buffer.byteLength(args.raw)
    for (const watcher of [...entry.watchers.values()]) {
      watcher.handleFrame({ frame: parsed, size })
    }
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
    for (const entry of this.entries.values()) {
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
