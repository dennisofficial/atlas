import type { HostTimers } from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import {
  compareFrameStamp,
  EStreamClearReason,
  type LiveFrame,
  type StreamServerMessage,
  type StreamStepKey,
} from '@dltech/atlas-protocol'

import { FOLLOW_HIGH_WATER_BYTES } from '../follow-limits'
import { foldLiveBuffer, type FoldedStep } from './fold-live-buffer'
import { atOrBefore, FrameOrder } from './frame-order'
import { isStepFrame, sameLengths, sameStep, type OpenStep, type StepFrame } from './step-frames'

export const OVERLAY_QUEUE_BYTES = 256 * 1024
export const JOIN_RETRY_BASE_MS = 250
export const JOIN_RETRY_MAX_MS = 5_000

export type QueuedFrame = { frame: LiveFrame; size: number }

type Pending = { frame: StepFrame; size: number }

type JoinRead = { ok: true; folded: FoldedStep | undefined } | { ok: false }

export type OverlayWatcherArgs = {
  id: string
  send(message: StreamServerMessage): void
  bufferedAmount(): number
  readBuffer(): Promise<string | null>
  timers: HostTimers
  log: LogPort | undefined
}

export class OverlayWatcher {
  private open: OpenStep | undefined
  private shown: StreamStepKey | undefined
  private queue: Pending[] | undefined = []
  private queuedBytes = 0
  private readonly order = new FrameOrder()
  private rejoin = false
  private forced = false
  private live = true
  private stale = false
  private stopped = false
  private retries = 0
  private retryTimer: unknown

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
    if (this.retryTimer !== undefined) this.args.timers.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  handleFrame(item: QueuedFrame): void {
    if (this.stopped) return
    if (this.stale && !this.overloaded()) {
      this.stale = false
      this.resync()
    }
    const { frame } = item
    if (!isStepFrame(frame)) {
      this.emit({ type: 'frame', id: this.args.id, frame })
      return
    }
    if (this.order.isStale(frame.at)) return
    if (this.queue !== undefined) {
      this.enqueue({ frame, size: item.size })
      return
    }
    this.apply({ item: { frame, size: item.size }, joined: false })
  }

  private requestJoin(trigger: Pending | undefined): void {
    if (this.queue !== undefined) {
      if (trigger !== undefined) this.enqueue(trigger)
      return
    }
    this.queue = []
    this.queuedBytes = 0
    if (trigger !== undefined) this.enqueue(trigger)
    void this.join()
  }

  private enqueue(item: Pending): void {
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

  private adopt(frame: Extract<StepFrame, { type: 'step-start' }>): void {
    if (this.open !== undefined) this.order.supersede()
    this.order.apply(frame.at)
    this.open = { key: frame.key, have: new Map() }
    this.emit({
      type: 'overlay',
      id: this.args.id,
      key: frame.key,
      afterSeq: frame.afterSeq,
      blocks: [],
    })
  }

  private apply(args: { item: Pending; joined: boolean }): void {
    const { item, joined } = args
    const { frame } = item
    if (!this.live || this.order.isStale(frame.at)) return
    const open = this.open
    if (open === undefined || !sameStep({ left: open.key, right: frame.key })) {
      if (frame.type === 'step-start') this.adopt(frame)
      else if (!joined) this.requestJoin(item)
      return
    }
    if (frame.type === 'step-start') return this.order.apply(frame.at)
    if (frame.type === 'step-end') {
      this.order.closeThrough(frame.at)
      this.open = undefined
      this.emit({ type: 'frame', id: this.args.id, frame })
      return
    }
    const have = open.have.get(frame.block) ?? 0
    if (frame.from > have) {
      this.requestJoin(item)
      return
    }
    this.order.apply(frame.at)
    if (frame.from + frame.text.length <= have) return
    const text = frame.text.slice(have - frame.from)
    open.have.set(frame.block, have + text.length)
    this.emit({
      type: 'delta',
      id: this.args.id,
      key: frame.key,
      block: frame.block,
      kind: frame.kind,
      from: have,
      text,
    })
  }

  private async join(): Promise<void> {
    this.rejoin = false
    const read = await this.readSnapshot()
    if (this.stopped) return
    if (!read.ok) {
      this.scheduleRetry()
      return
    }
    const items = this.queue ?? []
    const { folded } = read
    const isCovered = ({ frame }: Pending): boolean =>
      folded !== undefined && atOrBefore({ at: frame.at, limit: folded.through })
    const after = items
      .filter((item) => !isCovered(item))
      .sort((a, b) => compareFrameStamp({ left: a.frame.at, right: b.frame.at }))
    this.applySnapshot(folded)
    this.forced = false
    if (this.rejoin) {
      this.queue = after
      this.queuedBytes = after.reduce((sum, item) => sum + item.size, 0)
      await this.join()
      return
    }
    this.retries = 0
    this.queue = undefined
    for (const item of after) {
      if (this.stopped) return
      if (this.queue !== undefined) this.enqueue(item)
      else this.apply({ item, joined: true })
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined || this.stopped) return
    const delay = Math.min(JOIN_RETRY_MAX_MS, JOIN_RETRY_BASE_MS * 2 ** this.retries)
    this.retries += 1
    this.retryTimer = this.args.timers.setTimeout(() => {
      this.retryTimer = undefined
      if (!this.stopped) void this.join()
    }, delay)
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

  private applySnapshot(folded: FoldedStep | undefined): void {
    const open = this.open
    const superseded = (key: StreamStepKey): boolean =>
      folded === undefined || !sameStep({ left: key, right: folded.key })
    if (open !== undefined && superseded(open.key)) this.order.supersede()
    if (folded?.end !== undefined) this.order.closeThrough(folded.through)
    if (folded !== undefined) this.order.apply(folded.through)
    if (folded === undefined || this.order.isClosed(folded.through)) {
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
    this.emit({
      type: 'overlay',
      id: this.args.id,
      key: folded.key,
      afterSeq: folded.afterSeq,
      blocks: folded.blocks,
    })
  }

  private closeShown(args: { folded: FoldedStep | undefined; reason: EStreamClearReason }): void {
    const { shown } = this
    if (shown === undefined) return
    const { folded } = args
    if (folded?.end !== undefined && sameStep({ left: shown, right: folded.key })) {
      this.emit({
        type: 'frame',
        id: this.args.id,
        frame: { type: 'step-end', key: folded.key, reason: folded.end, at: folded.through },
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
