import {
  EventLogPort,
  stampDrafts,
  toEventId,
  toRunId,
  type ClockPort,
  type Event,
  type EventDraft,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
  type ThreadId,
} from '@dltech/atlas-core'

export class GatedLog extends EventLogPort {
  readonly stored: Event[] = []
  gate: Promise<void> | undefined
  failing: Error | undefined
  attempts = 0
  private seq = 0

  async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    this.attempts += 1
    await this.gate
    if (this.failing !== undefined) throw this.failing
    this.seq += 1
    const runId = toRunId(`run-${this.seq}`)
    const envelopes = args.drafts.map((_, at) => ({
      id: toEventId(`event-${this.seq}-${at}`),
      seq: this.stored.length + at + 1,
      threadId: args.threadId,
      runId,
      depth: 0,
      at: '2026-09-26T00:00:00.000Z',
    }))
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  ofType(type: EventDraft['type'], threadId?: ThreadId): Event[] {
    return this.stored.filter(
      (event) => event.type === type && (threadId === undefined || event.threadId === threadId),
    )
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }
  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }
  async replace(): Promise<Event[]> {
    return []
  }
  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return this.seq
  }
}

export const gateOf = (): { gate: Promise<void>; open: () => void } => {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return { gate, open }
}

export class FixedClock implements ClockPort {
  now(): string {
    return '2026-09-02T12:00:00.000Z'
  }
}

export class ExitablePort implements ProcessPort {
  private readonly ends: ((code: number) => void)[] = []

  spawn(args: SpawnCommand): ProcessHandle {
    void args
    const at = this.ends.length
    return {
      stdout: new ReadableStream({ start: (controller) => controller.close() }),
      stderr: new ReadableStream({ start: (controller) => controller.close() }),
      exited: new Promise<number>((resolve) => {
        this.ends.push(resolve)
      }),
      terminate: () => this.exit({ code: 143, at }),
    }
  }

  exit({ code, at = this.ends.length - 1 }: { code: number; at?: number }): void {
    this.ends[at]?.(code)
  }

  which(): string | null {
    return null
  }
}
