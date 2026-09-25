import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EShellStatus,
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

import { ShellRecovery } from '../recovery'

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

  async head(): Promise<number> {
    return this.seq
  }
}

const thread = toThreadId('thread-1')

const startedDraft = (args: {
  shellId: string
  command: string
  description?: string | undefined
}): EventDraft => ({
  type: 'background-shell-started',
  shellId: args.shellId,
  command: args.command,
  description: args.description,
})

const endedDraft = (args: { shellId: string; command: string }): EventDraft => ({
  type: 'background-shell-ended',
  shellId: args.shellId,
  command: args.command,
  status: EShellStatus.Exited,
  exitCode: 0,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const setup = () => {
  const ids = new SequenceIds()
  const log = new MemoryLog(ids)
  const recovery = new ShellRecovery({ log, ids })
  return { ids, log, recovery }
}

describe('ShellRecovery.recordLost', () => {
  it('settles a shell that started and never ended', async () => {
    const { ids, log, recovery } = setup()
    await log.append({ threadId: thread, runId: ids.nextRunId(), drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' })] })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { shellId: 'bash_1', command: 'bun test', description: undefined },
    ])

    const ending = log.stored.at(-1)
    expect(ending?.type).toBe('background-shell-ended')
    if (ending?.type !== 'background-shell-ended') throw new Error('expected an ending')
    expect(ending.shellId).toBe('bash_1')
    expect(ending.command).toBe('bun test')
    expect(ending.status).toBe(EShellStatus.Killed)
    expect(ending.killedBy).toBe(EKilledBy.Unrecorded)
    expect(ending.output).toBe('')
    expect(ending.droppedCharacters).toBe(0)
    expect(ending.remainingCharacters).toBe(0)
    expect(ending.exitCode).toBeUndefined()
  })

  it('leaves a started-and-ended shell alone', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' }), endedDraft({ shellId: 'bash_1', command: 'bun test' })],
    })

    const before = log.stored.length
    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([])
    expect(log.stored.length).toBe(before)
  })

  it('pairs chronologically when an id is reused across boots, so only the later start is open', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: toRunId('boot-1'),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'first boot' })],
    })
    await log.append({
      threadId: thread,
      runId: toRunId('boot-1'),
      drafts: [endedDraft({ shellId: 'bash_1', command: 'first boot' })],
    })
    await log.append({
      threadId: thread,
      runId: toRunId('boot-2'),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'second boot' })],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([{ shellId: 'bash_1', command: 'second boot', description: undefined }])
    const ending = log.stored.at(-1)
    if (ending?.type !== 'background-shell-ended') throw new Error('expected an ending')
    expect(ending.command).toBe('second boot')
  })

  it('settles every open start when two shells outlived the crash', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ shellId: 'bash_1', command: 'one' }),
        startedDraft({ shellId: 'bash_2', command: 'two' }),
        endedDraft({ shellId: 'bash_1', command: 'one' }),
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled.map((shell) => shell.shellId)).toEqual(['bash_2'])
  })

  it('runs once per thread per process: a second call settles nothing again', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' })],
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
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        {
          type: 'background-shell-ended',
          shellId: 'bash_1',
          command: 'bun test',
          status: EShellStatus.Killed,
          killedBy: EKilledBy.SessionEnd,
          output: '',
          droppedCharacters: 0,
          remainingCharacters: 0,
        },
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([])
  })
})
