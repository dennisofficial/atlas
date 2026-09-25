import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'

import {
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CallId,
  type Event,
  type EventDraft,
  type EventId,
  type EventEnvelope,
  type EventLogPort,
  type RunId,
  type ThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { HookChain } from '../../../hooks/registry'
import { BunShellRegistry } from '../../../shells/shell-registry'
import { SystemClock } from '../../../store'
import { BashTool } from '../bash'

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

class RecordingLog implements Pick<EventLogPort, 'append'> {
  readonly appended: Event[] = []
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
    this.appended.push(...stamped)
    return stamped
  }
}

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-bash-record-'))
})

const noHooks = () => new HookChain({})

describe('BashTool background start recording', () => {
  it('appends a durable background-shell-started the moment a background shell is tracked', async () => {
    const ids = new SequenceIds()
    const log = new RecordingLog(ids)
    const registry = new BunShellRegistry(root, new SystemClock(), noHooks)
    const tool = new BashTool(registry, undefined, undefined, { log, ids })

    const outcome: ToolOutcome = await tool.invoke({
      input: { command: 'sleep 30', description: 'record me', runInBackground: true },
      signal: new AbortController().signal,
      idempotencyKey: 'bash-record-1',
      projectDirectory: root,
      threadId: toThreadId('thread-1'),
    })

    expect(outcome.ok).toBe(true)
    const recorded = log.appended.find((event) => event.type === 'background-shell-started')
    expect(recorded).toBeDefined()
    if (recorded?.type !== 'background-shell-started') throw new Error('expected a start record')
    expect(recorded.command).toBe('sleep 30')
    expect(recorded.description).toBe('record me')
    expect(recorded.shellId).toMatch(/^bash_/)

    await registry.closeAll()
  })

  it('still starts the shell when no log is wired in', async () => {
    const registry = new BunShellRegistry(root, new SystemClock(), noHooks)
    const tool = new BashTool(registry)

    const outcome = await tool.invoke({
      input: { command: 'sleep 30', description: 'no log', runInBackground: true },
      signal: new AbortController().signal,
      idempotencyKey: 'bash-record-2',
      projectDirectory: root,
      threadId: toThreadId('thread-1'),
    })

    expect(outcome.ok).toBe(true)
    await registry.closeAll()
  })
})
