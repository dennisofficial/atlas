import {
  EThreadStreamFrame,
  type ThreadEventsSnapshot,
  type ThreadStreamFrame,
  type WireEvent,
} from '@dltech/atlas-wire'
import { decodeThreadEventCursor, type ThreadEventCursor } from './thread-event-cursor'
import type { EventSnapshotReader } from './thread-events-snapshot'

type EventControl = Extract<
  ThreadStreamFrame,
  {
    type: EThreadStreamFrame.Head | EThreadStreamFrame.Events | EThreadStreamFrame.Reset
  }
>

const isEventControl = (frame: ThreadStreamFrame): frame is EventControl =>
  frame.type === EThreadStreamFrame.Head ||
  frame.type === EThreadStreamFrame.Events ||
  frame.type === EThreadStreamFrame.Reset

export function contiguousEvents(args: {
  events: readonly WireEvent[]
  seq: number
  head: number
}): boolean {
  return (
    args.events.length === args.head - args.seq &&
    args.events.every((event, index) => event.seq === args.seq + index + 1)
  )
}

export class ThreadEventOrder {
  cursor: ThreadEventCursor = { historyRev: 0, seq: 0 }
  private observedEpoch = -1
  private generation = 0

  constructor(private readonly readSnapshot: EventSnapshotReader) {}

  observe(frame: ThreadStreamFrame): void {
    if (!isEventControl(frame)) return
    if (frame.historyRev !== undefined && frame.historyRev > this.observedEpoch) {
      this.observedEpoch = frame.historyRev
      this.generation += 1
    }
    if (frame.type === EThreadStreamFrame.Reset && frame.historyRev === undefined) {
      this.generation += 1
    }
  }

  isCurrent(frame: ThreadStreamFrame): boolean {
    return !isEventControl(frame) || (frame.historyRev ?? -1) >= this.observedEpoch
  }

  async open(args: {
    snapshot: ThreadEventsSnapshot
    lastEventId: string | undefined
  }): Promise<ThreadStreamFrame | undefined> {
    let snapshot = args.snapshot
    if (snapshot.historyRev < this.observedEpoch) {
      const generation = this.generation
      snapshot = await this.readSnapshot({ stateOnly: true })
      if (generation !== this.generation || snapshot.historyRev < this.observedEpoch)
        return undefined
    }
    this.observedEpoch = Math.max(this.observedEpoch, snapshot.historyRev)
    const resume = decodeThreadEventCursor(args.lastEventId)
    if (
      args.lastEventId !== undefined &&
      (resume === undefined ||
        resume.historyRev !== snapshot.historyRev ||
        resume.seq > snapshot.head)
    ) {
      return this.reset(snapshot)
    }
    this.cursor = resume ?? { historyRev: snapshot.historyRev, seq: snapshot.head }
    return { type: EThreadStreamFrame.Head, head: snapshot.head, historyRev: snapshot.historyRev }
  }

  async catchUp(): Promise<ThreadStreamFrame | undefined> {
    const generation = this.generation
    const snapshot = await this.readSnapshot({ fromSeq: this.cursor.seq + 1 })
    if (generation !== this.generation || snapshot.historyRev < this.observedEpoch) return undefined
    if (
      snapshot.historyRev !== this.cursor.historyRev ||
      snapshot.head < this.cursor.seq ||
      !contiguousEvents({ events: snapshot.events, seq: this.cursor.seq, head: snapshot.head })
    ) {
      return this.reset(snapshot)
    }
    if (snapshot.head === this.cursor.seq) return undefined
    const fromSeq = this.cursor.seq + 1
    this.cursor = { historyRev: snapshot.historyRev, seq: snapshot.head }
    return {
      type: EThreadStreamFrame.Events,
      fromSeq,
      events: snapshot.events,
      historyRev: snapshot.historyRev,
    }
  }

  async accept(frame: ThreadStreamFrame): Promise<ThreadStreamFrame | undefined> {
    if (!isEventControl(frame)) return frame
    if (frame.historyRev !== undefined && frame.historyRev < this.observedEpoch) return undefined
    if (
      this.observedEpoch > this.cursor.historyRev ||
      (frame.type === EThreadStreamFrame.Reset && frame.historyRev === undefined)
    ) {
      return this.resetCurrent()
    }
    if (frame.historyRev !== undefined && frame.historyRev < this.cursor.historyRev)
      return undefined
    if (frame.type === EThreadStreamFrame.Reset) return undefined
    if (frame.type === EThreadStreamFrame.Head) {
      if (frame.historyRev === this.cursor.historyRev && frame.head <= this.cursor.seq)
        return undefined
      return this.catchUp()
    }
    if (
      frame.historyRev !== this.cursor.historyRev ||
      frame.events.length === 0 ||
      frame.fromSeq !== frame.events[0]?.seq
    )
      return this.catchUp()
    const events = frame.events.filter((event) => event.seq > this.cursor.seq)
    const head = events.at(-1)?.seq
    if (head === undefined) return undefined
    if (!contiguousEvents({ events, seq: this.cursor.seq, head })) return this.catchUp()
    const fromSeq = this.cursor.seq + 1
    this.cursor = { ...this.cursor, seq: head }
    return { ...frame, fromSeq, events }
  }

  private async resetCurrent(): Promise<ThreadStreamFrame | undefined> {
    const generation = this.generation
    const snapshot = await this.readSnapshot({ stateOnly: true })
    if (generation !== this.generation || snapshot.historyRev < this.observedEpoch) return undefined
    return this.reset(snapshot)
  }

  private reset(snapshot: ThreadEventsSnapshot): ThreadStreamFrame {
    this.observedEpoch = Math.max(this.observedEpoch, snapshot.historyRev)
    this.cursor = { historyRev: snapshot.historyRev, seq: snapshot.head }
    return { type: EThreadStreamFrame.Reset, head: snapshot.head, historyRev: snapshot.historyRev }
  }
}
