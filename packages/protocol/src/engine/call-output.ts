import { ECallFailure, type CallResult, type OpName } from '../ops'
import type { CallStore } from './call-store'
import { failedResult } from './results'

export const OUTPUT_FRAME_BYTES = 64 * 1024

export type CallSink = {
  output(args: { offset: number; bytes: Uint8Array }): void
  result(args: { result: CallResult }): void
}

export class CallOutput {
  private assigned: number
  private closed = false
  private lostBytes = false
  private ended: CallResult | null = null
  private tail: Promise<void> = Promise.resolve()
  private readonly sinks = new Map<object, CallSink>()
  private readonly owed = new Map<object, number>()
  private readonly unreadable = new Map<object, { sink: CallSink; owed: number }>()
  private readonly cursors = new WeakMap<object, number>()
  private readonly detached = new WeakSet<object>()

  constructor(
    private readonly args: {
      key: string
      op: OpName
      store: CallStore
      storedBytes?: number | undefined
      onFault(args: { error: unknown }): void
    },
  ) {
    this.assigned = args.storedBytes ?? 0
  }

  bytes(): number {
    return this.assigned
  }

  lost(): boolean {
    return this.lostBytes
  }

  lostResult(): CallResult {
    return failedResult({
      op: this.args.op,
      code: ECallFailure.OutputLost,
      message: `the output of ${this.args.key} could not be stored or read back`,
    })
  }

  write(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return
    const offset = this.assigned
    const copy = new Uint8Array(bytes)
    this.assigned += copy.length
    this.enqueue(async () => {
      if (this.lostBytes) return
      try {
        await this.args.store.appendOutput({ key: this.args.key, bytes: copy })
      } catch (error) {
        this.lostBytes = true
        this.args.onFault({ error })
        return
      }
      for (const [owner, sink] of this.sinks) this.deliver({ owner, sink, offset, bytes: copy })
    })
  }

  attach(args: { owner: object; sink: CallSink; fromOffset: number }): void {
    this.enqueue(async () => {
      if (this.detached.has(args.owner)) return
      const from = Math.max(this.cursors.get(args.owner) ?? 0, args.fromOffset)
      this.cursors.set(args.owner, from)
      let stored: Uint8Array
      try {
        stored = await this.args.store.readOutput({ key: this.args.key, offset: from })
      } catch (error) {
        this.args.onFault({ error })
        if (this.detached.has(args.owner)) return
        if (this.ended !== null) {
          args.sink.result({ result: this.lostResult() })
          return
        }
        const owed = (this.unreadable.get(args.owner)?.owed ?? 0) + 1
        this.unreadable.set(args.owner, { sink: args.sink, owed })
        return
      }
      if (this.detached.has(args.owner)) return
      this.deliver({ owner: args.owner, sink: args.sink, offset: from, bytes: stored })
      if (this.ended !== null) {
        args.sink.result({ result: this.ended })
        return
      }
      this.sinks.set(args.owner, args.sink)
      this.owed.set(args.owner, (this.owed.get(args.owner) ?? 0) + 1)
    })
  }

  detach(args: { owner: object }): void {
    this.detached.add(args.owner)
    this.sinks.delete(args.owner)
    this.owed.delete(args.owner)
    this.unreadable.delete(args.owner)
  }

  close(): void {
    this.closed = true
  }

  end(args: { result: CallResult }): void {
    this.closed = true
    this.enqueue(async () => {
      this.ended = args.result
      for (const [owner, sink] of this.sinks) {
        const owed = this.owed.get(owner) ?? 0
        for (let sent = 0; sent < owed; sent++) sink.result({ result: args.result })
      }
      for (const { sink, owed } of this.unreadable.values()) {
        for (let sent = 0; sent < owed; sent++) sink.result({ result: this.lostResult() })
      }
      this.sinks.clear()
      this.owed.clear()
      this.unreadable.clear()
    })
  }

  drain(): Promise<void> {
    return this.tail
  }

  private deliver(args: {
    owner: object
    sink: CallSink
    offset: number
    bytes: Uint8Array
  }): void {
    const cursor = this.cursors.get(args.owner) ?? 0
    const end = args.offset + args.bytes.length
    if (end <= cursor) return
    const skip = Math.max(0, cursor - args.offset)
    for (let at = args.offset + skip; at < end; at += OUTPUT_FRAME_BYTES) {
      const frameEnd = Math.min(end, at + OUTPUT_FRAME_BYTES)
      args.sink.output({
        offset: at,
        bytes: args.bytes.subarray(at - args.offset, frameEnd - args.offset),
      })
    }
    this.cursors.set(args.owner, end)
  }

  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(async () => {
      try {
        await task()
      } catch (error) {
        this.args.onFault({ error })
      }
    })
  }
}
