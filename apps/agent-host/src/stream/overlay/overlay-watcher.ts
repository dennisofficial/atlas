import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  EStreamClearReason,
  type LiveFrame,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { foldLiveBuffer, type FoldedStep } from './fold-live-buffer'
import { ClosedSteps, isStepFrame, sameStep } from './step-frames'

export const OVERLAY_QUEUE_BYTES = 256 * 1024
export const MAX_JOIN_READS = 4

type OpenStep = { key: StreamStepKey; have: Map<string, number> }

export type QueuedFrame = { frame: LiveFrame; size: number }

type JoinRead = { ok: true; folded: FoldedStep | undefined } | { ok: false }

export type OverlayWatcherArgs = {
  id: string
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  readBuffer(): Promise<string | null>
  log: LogPort | undefined
}

const sameLengths = (args: { left: Map<string, number>; right: Map<string, number> }): boolean =>
  args.left.size === args.right.size &&
  [...args.left].every(([block, length]) => args.right.get(block) === length)

export class OverlayWatcher {
  private readonly closed = new ClosedSteps()
  private open: OpenStep | undefined
  private shown: StreamStepKey | undefined
  private queue: QueuedFrame[] | undefined = []
  private queuedBytes = 0
  private rejoin = false
  private forced = false
  private live = true
  private stale = false
  private stopped = false

  constructor(private readonly args: OverlayWatcherArgs) {}

  start(): void {
    void this.join()
  }

  resync(): void {
    this.forced = true
    this.requestJoin(undefined)
  }

  setLive(live: boolean): void {
    if (this.stopped || live === this.live) return
    this.live = live
    if (live) {
      this.resync()
      return
    }
    this.open = undefined
    this.closeShown({ folded: undefined, reason: EStreamClearReason.HolderLost })
  }

  stop(): void {
    this.stopped = true
    this.queue = undefined
  }

  handleFrame(item: QueuedFrame): void {
    if (this.stopped) return
    if (this.queue !== undefined) {
      this.enqueue(item)
      return
    }
    if (this.stale && !this.overloaded()) {
      this.stale = false
      this.forced = true
      this.requestJoin(item)
      return
    }
    this.apply(item)
  }

  private requestJoin(trigger: QueuedFrame | undefined): void {
    if (this.queue !== undefined) {
      this.rejoin = true
      if (trigger !== undefined) this.enqueue(trigger)
      return
    }
    this.queue = []
    this.queuedBytes = 0
    if (trigger !== undefined) this.enqueue(trigger)
    void this.join()
  }

  private enqueue(item: QueuedFrame): void {
    if (this.queue === undefined) return
    if (this.queuedBytes + item.size > OVERLAY_QUEUE_BYTES) {
      this.queue = []
      this.queuedBytes = 0
      this.rejoin = true
      this.forced = true
      return
    }
    this.queue.push(item)
    this.queuedBytes += item.size
  }

  private apply(item: QueuedFrame): void {
    const { frame } = item
    if (!isStepFrame(frame)) {
      this.emit({ type: 'frame', id: this.args.id, frame })
      return
    }
    if (!this.live || this.closed.has(frame.key)) return
    const open = this.open
    if (open === undefined || !sameStep({ left: open.key, right: frame.key })) {
      this.requestJoin(item)
      return
    }
    if (frame.type === 'step-start') return
    if (frame.type === 'step-end') {
      this.closed.add(frame.key)
      this.open = undefined
      this.emit({ type: 'frame', id: this.args.id, frame })
      return
    }
    const have = open.have.get(frame.block) ?? 0
    if (frame.from + frame.text.length <= have) return
    if (frame.from > have) {
      this.requestJoin(item)
      return
    }
    const text = frame.text.slice(have - frame.from)
    open.have.set(frame.block, have + text.length)
    this.emit({ ...frame, id: this.args.id, from: have, text })
  }

  private async join(): Promise<void> {
    let read: JoinRead = { ok: false }
    let mark = 0
    for (let reads = 1; ; reads += 1) {
      this.rejoin = false
      mark = this.queue?.length ?? 0
      read = await this.readSnapshot()
      if (this.stopped) return
      if (!read.ok) break
      if (!this.rejoin) break
      if (reads >= MAX_JOIN_READS) break
    }
    const items = this.queue ?? []
    this.queue = undefined
    const covered = read.ok ? items.slice(0, mark) : []
    if (read.ok) this.applySnapshot({ folded: read.folded, covered })
    this.forced = false
    for (const item of covered) {
      if (!isStepFrame(item.frame))
        this.emit({ type: 'frame', id: this.args.id, frame: item.frame })
    }
    for (const item of read.ok ? items.slice(mark) : items) {
      if (this.stopped) return
      if (this.queue !== undefined) this.enqueue(item)
      else this.apply(item)
    }
  }

  private async readSnapshot(): Promise<JoinRead> {
    try {
      return { ok: true, folded: foldLiveBuffer(await this.args.readBuffer()) }
    } catch (error) {
      this.args.log?.error({
        source: 'stream',
        message: 'reading the live buffer failed',
        ...logFieldsOf({ error }),
      })
      return { ok: false }
    }
  }

  private applySnapshot(args: {
    folded: FoldedStep | undefined
    covered: readonly QueuedFrame[]
  }): void {
    const { folded } = args
    const superseded = (key: StreamStepKey): boolean =>
      folded === undefined || !sameStep({ left: key, right: folded.key })
    for (const { frame } of args.covered) {
      if (isStepFrame(frame) && superseded(frame.key)) this.closed.add(frame.key)
    }
    const open = this.open
    if (open !== undefined && superseded(open.key)) this.closed.add(open.key)
    if (folded?.end !== undefined) this.closed.add(folded.key)
    if (folded === undefined || this.closed.has(folded.key)) {
      this.open = undefined
      this.closeShown({ folded, reason: EStreamClearReason.Lost })
      return
    }
    if (!this.live) {
      this.open = undefined
      this.closeShown({ folded: undefined, reason: EStreamClearReason.HolderLost })
      return
    }
    const have = new Map(folded.blocks.map((block) => [block.block, block.text.length]))
    const unchanged =
      !this.forced &&
      this.shown !== undefined &&
      sameStep({ left: this.shown, right: folded.key }) &&
      open !== undefined &&
      !superseded(open.key) &&
      sameLengths({ left: open.have, right: have })
    this.open = { key: folded.key, have }
    if (unchanged) return
    this.emit({ type: 'overlay', id: this.args.id, key: folded.key, blocks: folded.blocks })
  }

  private closeShown(args: { folded: FoldedStep | undefined; reason: EStreamClearReason }): void {
    const { shown } = this
    if (shown === undefined) return
    const { folded } = args
    if (folded?.end !== undefined && sameStep({ left: shown, right: folded.key })) {
      this.emit({
        type: 'frame',
        id: this.args.id,
        frame: { type: 'step-end', key: folded.key, reason: folded.end },
      })
      return
    }
    this.emit({ type: 'overlay-clear', id: this.args.id, reason: args.reason })
  }

  private overloaded(): boolean {
    return this.args.bufferedAmount() >= FOLLOW_HIGH_WATER_BYTES
  }

  private emit(message: StreamServerMessage): void {
    if (this.overloaded()) {
      this.stale = true
      return
    }
    this.track(message)
    this.args.send(message)
  }

  private track(message: StreamServerMessage): void {
    if (message.type === 'overlay') this.shown = message.key
    if (message.type === 'overlay-clear') this.shown = undefined
    if (message.type !== 'frame' || message.frame.type !== 'step-end') return
    if (this.shown !== undefined && sameStep({ left: this.shown, right: message.frame.key })) {
      this.shown = undefined
    }
  }
}
