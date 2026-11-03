import type { CallResult } from '../ops'
import type { CallStore } from './call-store'

export type CallSink = {
  output(args: { offset: number; bytes: Uint8Array }): void
  result(args: { result: CallResult }): void
}

export class CallOutput {
  private assigned = 0
  private closed = false
  private ended: CallResult | null = null
  private tail: Promise<void> = Promise.resolve()
  private readonly sinks = new Map<object, CallSink>()
  private readonly owed = new Map<object, number>()
  private readonly cursors = new WeakMap<object, number>()
  private readonly detached = new WeakSet<object>()

  constructor(
    private readonly args: {
      key: string
      store: CallStore
      onFault(args: { error: unknown }): void
    },
  ) {}

  bytes(): number {
    return this.assigned
  }

  write(bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return
    const offset = this.assigned
    const copy = new Uint8Array(bytes)
    this.assigned += copy.length
    this.enqueue(async () => {
      await this.args.store.appendOutput({ key: this.args.key, bytes: copy })
      for (const [owner, sink] of this.sinks) this.deliver({ owner, sink, offset, bytes: copy })
    })
  }

  attach(args: { owner: object; sink: CallSink; fromOffset: number }): void {
    this.enqueue(async () => {
      if (this.detached.has(args.owner)) return
      const from = Math.max(this.cursors.get(args.owner) ?? 0, args.fromOffset)
      this.cursors.set(args.owner, from)
      const stored = await this.args.store.readOutput({ key: this.args.key, offset: from })
      this.deliver({ owner: args.owner, sink: args.sink, offset: from, bytes: stored })
      if (this.ended === null) {
        this.sinks.set(args.owner, args.sink)
        this.owed.set(args.owner, (this.owed.get(args.owner) ?? 0) + 1)
        return
      }
      args.sink.result({ result: this.ended })
    })
  }

  detach(args: { owner: object }): void {
    this.detached.add(args.owner)
    this.sinks.delete(args.owner)
    this.owed.delete(args.owner)
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
      this.sinks.clear()
      this.owed.clear()
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
    args.sink.output({ offset: args.offset + skip, bytes: args.bytes.subarray(skip) })
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
