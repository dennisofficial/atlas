import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  ERewindRefusal,
  toCallId,
  toRunId,
  toThreadId,
  type ThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { LocalRewindMachinery } from '../local-rewind-machinery'
import { rewindThread } from '../rewind'
import { openStoreFixture, type StoreFixture } from './harness'

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

const rewind = (args: { threadId: ThreadId; toSeq: number; confirmed?: boolean }) =>
  rewindThread({
    log: fixture.log,
    threads: fixture.threads,
    machinery: new LocalRewindMachinery({
      agents: fixture.agents,
      shells: fixture.shells,
      services: fixture.services,
    }),
    threadId: args.threadId,
    toSeq: args.toSeq,
    ...(args.confirmed === undefined ? {} : { confirmed: args.confirmed }),
  })

const openExchange = async (): Promise<ThreadId> => {
  fixture = await openStoreFixture()
  const thread = await fixture.threads.create({ title: 'work' })
  await fixture.log.append({
    threadId: thread.id,
    runId,
    drafts: [said('clean the build'), replied('on it'), called, resulted, replied('done')],
  })
  return thread.id
}

afterEach(async () => {
  await fixture.close()
})

describe('rewindThread', () => {
  it('truncates the thread to a settled point and reports what it discarded', async () => {
    const threadId = await openExchange()

    const result = await rewind({ threadId, toSeq: 2 })

    expect(result).toEqual({ ok: true, discarded: 3, kills: [] })
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual([
      'user-said',
      'assistant-said',
    ])
    expect((await fixture.threads.find({ threadId }))?.head).toBe(2)
  })

  it('refuses a target that would re-dispatch a tool call, which the surviving idempotencyKey does not deduplicate', async () => {
    const threadId = await openExchange()

    const result = await rewind({ threadId, toSeq: 3 })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.UnsettledToolCall })
    expect((await fixture.log.read({ threadId })).length).toBe(5)
    expect((await fixture.threads.find({ threadId }))?.head).toBe(5)
  })

  it('refuses a sequence the thread never reached, and writes nothing', async () => {
    const threadId = await openExchange()

    const result = await rewind({ threadId, toSeq: 9 })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.NoSuchTarget })
    expect((await fixture.log.read({ threadId })).length).toBe(5)
    expect((await fixture.threads.find({ threadId }))?.head).toBe(5)
  })

  it('leaves the thread ready for the next exchange', async () => {
    const threadId = await openExchange()

    await rewind({ threadId, toSeq: 0 })
    const appended = await fixture.log.append({ threadId, runId, drafts: [said('start over')] })

    expect(appended.map((event) => event.seq)).toEqual([1])
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
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
  it('asks before cutting below a spawn, naming the child, and writes nothing', async () => {
    const threadId = await openDelegation([said('delegate it'), spawned, replied('spawned one')])

    const result = await rewind({ threadId, toSeq: 1 })

    expect(result).toEqual({
      ok: false,
      needsConfirmation: true,
      toSeq: 1,
      reachable: true,
      kills: [
        {
          kind: 'agent',
          agentId: CHILD,
          agentType: 'explore',
          intent: 'find the callers',
          running: false,
        },
      ],
    })
    expect((await fixture.log.read({ threadId })).length).toBe(3)
    expect((await fixture.threads.find({ threadId }))?.head).toBe(3)
  })

  it('destroys the child with the deleted delegation once confirmed', async () => {
    const threadId = await openDelegation([said('delegate it'), spawned, replied('spawned one')])

    const result = await rewind({ threadId, toSeq: 1, confirmed: true })

    expect(result).toMatchObject({ ok: true, discarded: 2 })
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
  })

  it('asks before cutting below the spawn of a child that ended, too — the record dies with it', async () => {
    const threadId = await openDelegation([
      said('delegate it'),
      spawned,
      agentEnded,
      replied('four callers'),
    ])

    const result = await rewind({ threadId, toSeq: 1 })

    expect(result).toMatchObject({ ok: false, needsConfirmation: true })
  })

  it('keeps the ending that landed above the cut when the spawn sits below it', async () => {
    const threadId = await openDelegation([
      said('delegate it'),
      spawned,
      said('msg_2'),
      agentEnded,
      said('msg_3'),
    ])

    const result = await rewind({ threadId, toSeq: 3 })

    expect(result).toEqual({ ok: true, discarded: 1, kills: [] })
    const events = await fixture.log.read({ threadId })
    expect(events.map((event) => event.type)).toEqual([
      'user-said',
      'agent-spawned',
      'user-said',
      'agent-ended',
    ])
    expect(events.at(-1)?.seq).toBe(4)
  })
})
