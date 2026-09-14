import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  EKilledBy,
  ERewindRefusal,
  toCallId,
  toRunId,
  toThreadId,
  type ThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { EShellStatus, type ShellSnapshot } from '../../shells/background-shell'
import { toShellId } from '../../shells/shell-id'
import { rewindThread } from '../rewind'
import { openStoreFixture, UnstaffedShells, type StoreFixture } from './harness'

let fixture: StoreFixture

const runId = toRunId('run-1')
const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const called: EventDraft = {
  type: 'tool-called',
  callId: toCallId('call-1'),
  name: 'bash',
  input: { command: 'rm -rf build' },
  ordinal: 0,
}
const resulted: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-1'),
  name: 'bash',
  output: { ok: true },
}

const openExchange = async (): Promise<{ fixture: StoreFixture; threadId: ThreadId }> => {
  fixture = await openStoreFixture()
  const thread = await fixture.threads.create({ title: 'work' })
  await fixture.log.append({
    threadId: thread.id,
    runId,
    drafts: [said('clean the build'), replied('on it'), called, resulted, replied('done')],
  })
  return { fixture, threadId: thread.id }
}

afterEach(async () => {
  await fixture.close()
})

describe('rewindThread', () => {
  it('truncates the thread to a settled point and reports what it discarded', async () => {
    const { fixture: store, threadId } = await openExchange()

    const result = await rewindThread({ log: store.log, threads: store.threads, agents: store.agents, shells: store.shells, threadId, toSeq: 2 })

    expect(result).toEqual({ ok: true, discarded: 3, cutShells: [] })
    expect((await store.log.read({ threadId })).map((event) => event.type)).toEqual([
      'user-said',
      'assistant-said',
    ])
    expect((await store.threads.find({ threadId }))?.head).toBe(2)
  })

  it('refuses a target that would re-dispatch a tool call, which the surviving idempotencyKey does not deduplicate', async () => {
    const { fixture: store, threadId } = await openExchange()

    const result = await rewindThread({ log: store.log, threads: store.threads, agents: store.agents, shells: store.shells, threadId, toSeq: 3 })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.UnsettledToolCall })
    expect((await store.log.read({ threadId })).length).toBe(5)
    expect((await store.threads.find({ threadId }))?.head).toBe(5)
  })

  it('refuses a sequence the thread never reached, and writes nothing', async () => {
    const { fixture: store, threadId } = await openExchange()

    const result = await rewindThread({ log: store.log, threads: store.threads, agents: store.agents, shells: store.shells, threadId, toSeq: 9 })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.NoSuchTarget })
    expect((await store.log.read({ threadId })).length).toBe(5)
    expect((await store.threads.find({ threadId }))?.head).toBe(5)
  })

  it('leaves the thread ready for the next exchange', async () => {
    const { fixture: store, threadId } = await openExchange()

    await rewindThread({ log: store.log, threads: store.threads, agents: store.agents, shells: store.shells, threadId, toSeq: 0 })
    const appended = await store.log.append({ threadId, runId, drafts: [said('start over')] })

    expect(appended.map((event) => event.seq)).toEqual([1])
    expect((await store.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
  })
})

const CHILD = toThreadId('thread_child')

const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'find the callers',
  mode: EAgentStart.Fresh,
}

const agentEnded: EventDraft = {
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'find the callers',
  status: EAgentStatus.Finished,
  prose: 'four callers',
  turns: 3,
  toolCalls: 7,
}

const openDelegation = async (drafts: readonly EventDraft[]): Promise<ThreadId> => {
  fixture = await openStoreFixture()
  const thread = await fixture.threads.create({ title: 'delegating' })
  await fixture.log.append({ threadId: thread.id, runId, drafts })
  return thread.id
}

describe('rewindThread on a thread that delegated', () => {
  it('refuses to cut below the spawn of a child nothing ended, and writes nothing', async () => {
    const threadId = await openDelegation([said('delegate it'), spawned, replied('spawned one')])

    const result = await rewindThread({
      log: fixture.log,
      threads: fixture.threads,
      agents: fixture.agents,
      shells: fixture.shells,
      threadId,
      toSeq: 1,
    })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.UnendedSubAgent })
    expect((await fixture.log.read({ threadId })).length).toBe(3)
    expect((await fixture.threads.find({ threadId }))?.head).toBe(3)
  })

  it('cuts below the spawn of a child that ended', async () => {
    const threadId = await openDelegation([
      said('delegate it'),
      spawned,
      agentEnded,
      replied('four callers'),
    ])

    const result = await rewindThread({
      log: fixture.log,
      threads: fixture.threads,
      agents: fixture.agents,
      shells: fixture.shells,
      threadId,
      toSeq: 1,
    })

    expect(result).toEqual({ ok: true, discarded: 3, cutShells: [] })
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
  })
})

class ScriptedShells extends UnstaffedShells {
  private live: { threadId: ThreadId; snapshot: ShellSnapshot }[] = []
  readonly removed: { shellId: string; by: EKilledBy }[] = []

  place({ threadId, shellId, command }: { threadId: ThreadId; shellId: string; command: string }): void {
    const at = new Date(Date.UTC(2026, 0, 1)).toISOString()
    this.live.push({
      threadId,
      snapshot: {
        shellId: toShellId(shellId),
        command,
        description: 'Run a background job',
        status: EShellStatus.Running,
        startedAt: at,
        lastOutputAt: at,
        totalCharacters: 0,
        awaitingInput: false,
      },
    })
  }

  override list({ threadId }: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return this.live.filter((entry) => entry.threadId === threadId).map((entry) => entry.snapshot)
  }

  override removeShells({
    threadId,
    shellIds,
    by,
  }: {
    threadId: ThreadId
    shellIds: readonly string[]
    by: EKilledBy
  }): void {
    for (const shellId of shellIds) this.removed.push({ shellId, by })
    this.live = this.live.filter(
      (entry) => entry.threadId !== threadId || !shellIds.includes(entry.snapshot.shellId),
    )
  }
}

const startedInBackground: EventDraft = {
  type: 'tool-called',
  callId: toCallId('call-bg'),
  name: 'bash',
  input: { command: 'npm test', runInBackground: true },
  ordinal: 0,
}

const backgrounded: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-bg'),
  name: 'bash',
  output: { shellId: 'bash_1', status: 'running' },
}

const shellEnded: EventDraft = {
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'npm test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: 'all green',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

const openShellThread = async (): Promise<{ threadId: ThreadId; shells: ScriptedShells }> => {
  fixture = await openStoreFixture()
  const shells = new ScriptedShells()
  const thread = await fixture.threads.create({ title: 'shells' })
  await fixture.log.append({
    threadId: thread.id,
    runId,
    drafts: [
      said('msg_1'),
      startedInBackground,
      backgrounded,
      replied('on it'),
      said('msg_2'),
      shellEnded,
      said('msg_3'),
    ],
  })
  shells.place({ threadId: thread.id, shellId: 'bash_1', command: 'npm test' })
  return { threadId: thread.id, shells }
}

describe('rewindThread on a thread with a background shell', () => {
  it('keeps the ending that landed above the cut, re-appended above the new head, when the shell started below it', async () => {
    const { threadId, shells } = await openShellThread()

    const result = await rewindThread({
      log: fixture.log,
      threads: fixture.threads,
      agents: fixture.agents,
      shells,
      threadId,
      toSeq: 5,
    })

    expect(result).toEqual({ ok: true, discarded: 1, cutShells: [] })
    const events = await fixture.log.read({ threadId })
    expect(events.map((event) => event.type)).toEqual([
      'user-said',
      'tool-called',
      'tool-result',
      'assistant-said',
      'user-said',
      'background-shell-ended',
    ])
    expect(events.at(-1)?.seq).toBe(6)
    expect((await fixture.threads.find({ threadId }))?.head).toBe(6)
    expect(shells.removed).toEqual([])
  })

  it('destroys the shell whole when the cut removes its start', async () => {
    const { threadId, shells } = await openShellThread()

    const result = await rewindThread({
      log: fixture.log,
      threads: fixture.threads,
      agents: fixture.agents,
      shells,
      threadId,
      toSeq: 1,
    })

    expect(result).toEqual({
      ok: true,
      discarded: 6,
      cutShells: [{ shellId: 'bash_1', command: 'npm test', description: 'Run a background job' }],
    })
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
    expect((await fixture.threads.find({ threadId }))?.head).toBe(1)
    expect(shells.removed).toEqual([{ shellId: 'bash_1', by: EKilledBy.Rewind }])
  })
})
