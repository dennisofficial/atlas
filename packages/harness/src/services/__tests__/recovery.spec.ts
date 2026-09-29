import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CallId,
  type Event,
  type EventDraft,
  type EventId,
  type EventLogPort,
  type EventEnvelope,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { ServiceRecovery } from '../recovery'

class SequenceIds {
  private handed = 0

  nextThreadId(): ThreadId {
    this.handed += 1
    return toThreadId(`thread-${this.handed}`)
  }

  nextCallId(): CallId {
    this.handed += 1
    return toCallId(`call-${this.handed}`)
  }

  nextRunId(): RunId {
    this.handed += 1
    return toRunId(`run-${this.handed}`)
  }

  nextEventId(): EventId {
    this.handed += 1
    return toEventId(`event-${this.handed}`)
  }
}

class MemoryLog implements EventLogPort {
  readonly stored: Event[] = []
  private seq = 0

  constructor(private readonly ids: SequenceIds) {}

  async append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly EventDraft[]
  }): Promise<Event[]> {
    const envelopes: EventEnvelope[] = args.drafts.map(() => {
      this.seq += 1
      return {
        id: this.ids.nextEventId(),
        seq: this.seq,
        threadId: args.threadId,
        runId: args.runId,
        depth: args.depth ?? 0,
        at: '2026-09-24T00:00:00.000Z',
      }
    })
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  async replace(): Promise<Event[]> {
    throw new Error('unneeded')
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }

  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }

  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return this.seq
  }
}

const thread = toThreadId('thread-1')

const startedDraft = (args: {
  serviceId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
}): EventDraft => ({
  type: 'service-started',
  serviceId: args.serviceId,
  command: args.command,
  description: args.description,
  bootId: args.bootId,
})

const endedDraft = (args: {
  serviceId: string
  command: string
  bootId?: string | undefined
}): EventDraft => ({
  type: 'service-ended',
  serviceId: args.serviceId,
  command: args.command,
  bootId: args.bootId,
  status: EServiceStatus.Exited,
  exitCode: 0,
  logPath: '/tmp/svc.log',
  tail: '',
})

const setup = () => {
  const ids = new SequenceIds()
  const log = new MemoryLog(ids)
  const recovery = new ServiceRecovery({ log, ids })
  return { ids, log, recovery }
}

describe('ServiceRecovery.recordLost', () => {
  it('settles a service that started and never ended', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { serviceId: 'svc_1', command: 'bun run dev', description: undefined },
    ])

    const ending = log.stored.at(-1)
    expect(ending?.type).toBe('service-ended')
    if (ending?.type !== 'service-ended') throw new Error('expected an ending')
    expect(ending.serviceId).toBe('svc_1')
    expect(ending.command).toBe('bun run dev')
    expect(ending.bootId).toBe('boot-1')
    expect(ending.status).toBe(EServiceStatus.Killed)
    expect(ending.killedBy).toBe(EKilledBy.Unrecorded)
    expect(ending.tail).toBe('')
    expect(ending.exitCode).toBeUndefined()
  })

  it('leaves a started-and-ended service alone', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' }),
        endedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' }),
      ],
    })

    const before = log.stored.length
    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([])
    expect(log.stored.length).toBe(before)
  })

  it('pairs chronologically when an id is reused within a boot, so only the later start is open', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'first', bootId: 'boot-1' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [endedDraft({ serviceId: 'svc_1', command: 'first', bootId: 'boot-1' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'second', bootId: 'boot-1' })],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([{ serviceId: 'svc_1', command: 'second', description: undefined }])
    const ending = log.stored.at(-1)
    if (ending?.type !== 'service-ended') throw new Error('expected an ending')
    expect(ending.command).toBe('second')
  })

  it('never settles a previous boot’s open start with a new boot’s end', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'crashed boot', bootId: 'boot-1' }),
        startedDraft({ serviceId: 'svc_1', command: 'fresh boot', bootId: 'boot-2' }),
        endedDraft({ serviceId: 'svc_1', command: 'fresh boot', bootId: 'boot-2' }),
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { serviceId: 'svc_1', command: 'crashed boot', description: undefined },
    ])
  })

  it('settles every open start when two services outlived the crash', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'one', bootId: 'boot-1' }),
        startedDraft({ serviceId: 'svc_2', command: 'two', bootId: 'boot-1' }),
        endedDraft({ serviceId: 'svc_1', command: 'one', bootId: 'boot-1' }),
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled.map((service) => service.serviceId)).toEqual(['svc_2'])
  })

  it('runs once per thread per process: a second call settles nothing again', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })

    await recovery.recordLost({ threadId: thread })
    const before = log.stored.length
    const again = await recovery.recordLost({ threadId: thread })

    expect(again).toEqual([])
    expect(log.stored.length).toBe(before)
  })

  it('is a no-op for a graceful restart, where teardown already recorded the endings', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        {
          type: 'service-ended',
          serviceId: 'svc_1',
          command: 'bun run dev',
          bootId: 'boot-1',
          status: EServiceStatus.Killed,
          killedBy: EKilledBy.SessionEnd,
          logPath: '/tmp/svc.log',
          tail: '',
        },
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([])
  })
})
