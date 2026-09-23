import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'

import {
  EAgentStart,
  EAgentStatus,
  ERewindRefusal,
  EForkMode,
  toCallId,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { readMetaSync, newThreadMeta, threadMetaSchema, writeMeta } from '../../meta'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../../paths'
import { rewindThread } from '../rewind'
import { closeOpsFixtures, openOpsFixture, openThread, reopenOpsFixture, type OpsFixture } from './fixture'

afterEach(async () => {
  await closeOpsFixtures()
})

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

const rewind = (fixture: OpsFixture, args: { threadId: ThreadId; toSeq: number; confirmed?: boolean }) =>
  rewindThread({
    log: fixture.log,
    registry: fixture.registry,
    clock: fixture.clock,
    ids: fixture.ids,
    agents: fixture.agents,
    shells: fixture.shells,
    services: fixture.services,
    threadId: args.threadId,
    toSeq: args.toSeq,
    ...(args.confirmed === undefined ? {} : { confirmed: args.confirmed }),
  })

const EXCHANGE = [said('clean the build'), replied('on it'), called, resulted, replied('done')]

describe('rewindThread over the sessions store', () => {
  it('truncates the log, keeps retained ids, and updates the thread meta head', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: EXCHANGE })
    const before = await fixture.log.read({ threadId })

    const result = await rewind(fixture, { threadId, toSeq: 2 })

    expect(result).toEqual({ ok: true, discarded: 3, kills: [], orphans: [] })
    const after = await fixture.log.read({ threadId })
    expect(after.map((event) => event.type)).toEqual(['user-said', 'assistant-said'])
    expect(after.map((event) => event.id)).toEqual(before.slice(0, 2).map((event) => event.id))

    const sessionDir = sessionDirectory({ home: fixture.home, sessionId: threadId })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId }), schema: threadMetaSchema })
    expect(meta?.head).toBe(2)
    expect(await fixture.log.head({ threadId })).toBe(2)
  })

  it('refuses a target that would re-dispatch a tool call and writes nothing', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: EXCHANGE })

    const result = await rewind(fixture, { threadId, toSeq: 3 })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.UnsettledToolCall })
    expect((await fixture.log.read({ threadId })).length).toBe(5)
    expect(await fixture.log.head({ threadId })).toBe(5)
  })

  it('refuses a sequence the thread never reached', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: EXCHANGE })

    const result = await rewind(fixture, { threadId, toSeq: 9 })

    expect(result).toMatchObject({ ok: false, refusal: ERewindRefusal.NoSuchTarget })
    expect((await fixture.log.read({ threadId })).length).toBe(5)
  })

  it('leaves the thread ready for the next exchange', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: EXCHANGE })

    await rewind(fixture, { threadId, toSeq: 0 })
    const appended = await fixture.log.append({
      threadId,
      runId: fixture.ids.nextRunId(),
      drafts: [said('start over')],
    })

    expect(appended.map((event) => event.seq)).toEqual([1])
  })

  it('serializes a rewind against a concurrent append through the session queue', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: EXCHANGE })

    const [result] = await Promise.all([
      rewind(fixture, { threadId, toSeq: 2 }),
      fixture.log.append({ threadId, runId: fixture.ids.nextRunId(), drafts: [said('late')] }),
    ])

    expect(result).toMatchObject({ ok: true })
    const events = await fixture.log.read({ threadId })
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(events.map((event) => event.type)).toEqual(['user-said', 'assistant-said', 'user-said'])
    expect(await fixture.log.head({ threadId })).toBe(3)

    const reopened = reopenOpsFixture({ fixture })
    const readAgain = await reopened.log.read({ threadId })
    expect(readAgain.map((event) => event.seq)).toEqual([1, 2, 3])
  })
})

const CHILD = toThreadId('brn_child')

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

async function openDelegation({
  fixture,
  drafts,
  referenced,
}: {
  fixture: OpsFixture
  drafts: readonly EventDraft[]
  referenced: boolean
}): Promise<{ threadId: ThreadId; sessionDir: string; childAt: string }> {
  const threadId = await openThread({ fixture, drafts })
  const sessionDir = sessionDirectory({ home: fixture.home, sessionId: threadId })
  const childAt = fixture.clock.now()
  await writeMeta({
    file: threadMetaFile({ sessionDir, threadId: CHILD }),
    meta: {
      ...newThreadMeta({ id: CHILD, at: childAt }),
      title: 'find the callers',
      spawnerThreadId: threadId,
      agentType: 'explore',
    },
  })
  fixture.registry.registerThread({ sessionDir, threadId: CHILD })
  await fixture.log.append({ threadId: CHILD, runId: fixture.ids.nextRunId(), drafts: [said('child work')] })

  if (referenced) {
    const grandchild = toThreadId('brn_grandchild')
    await writeMeta({
      file: threadMetaFile({ sessionDir, threadId: grandchild }),
      meta: {
        ...newThreadMeta({ id: grandchild, at: childAt }),
        parentThreadId: CHILD,
        forkSeq: 1,
        forkMode: EForkMode.Reference,
      },
    })
  }
  return { threadId, sessionDir, childAt }
}

describe('rewindThread child destruction', () => {
  it('asks before cutting below a spawn, naming the child, and writes nothing', async () => {
    const fixture = await openOpsFixture()
    const { threadId, sessionDir } = await openDelegation({
      fixture,
      drafts: [said('delegate it'), spawned, replied('spawned one')],
      referenced: false,
    })

    const result = await rewind(fixture, { threadId, toSeq: 1 })

    expect(result).toEqual({
      ok: false,
      needsConfirmation: true,
      toSeq: 1,
      kills: [
        { kind: 'agent', agentId: CHILD, agentType: 'explore', intent: 'find the callers', running: false },
      ],
    })
    expect((await fixture.log.read({ threadId })).length).toBe(3)
    expect(existsSync(eventLogFile({ sessionDir, threadId: CHILD }))).toBe(true)
  })

  it('deletes an unreferenced child once confirmed and reports it as an orphan', async () => {
    const fixture = await openOpsFixture()
    const { threadId, sessionDir, childAt } = await openDelegation({
      fixture,
      drafts: [said('delegate it'), spawned, replied('spawned one')],
      referenced: false,
    })

    const result = await rewind(fixture, { threadId, toSeq: 1, confirmed: true })

    expect(result).toEqual({
      ok: true,
      discarded: 2,
      kills: [
        { kind: 'agent', agentId: CHILD, agentType: 'explore', intent: 'find the callers', running: false },
      ],
      orphans: [{ agentId: CHILD, agentType: 'explore', title: 'find the callers', startedAt: childAt }],
    })
    expect((await fixture.log.read({ threadId })).map((event) => event.type)).toEqual(['user-said'])
    expect(existsSync(eventLogFile({ sessionDir, threadId: CHILD }))).toBe(false)
    expect(existsSync(threadMetaFile({ sessionDir, threadId: CHILD }))).toBe(false)
  })

  it('detaches a referenced child instead of deleting it', async () => {
    const fixture = await openOpsFixture()
    const { threadId, sessionDir } = await openDelegation({
      fixture,
      drafts: [said('delegate it'), spawned, replied('spawned one')],
      referenced: true,
    })

    const result = await rewind(fixture, { threadId, toSeq: 1, confirmed: true })

    expect(result).toMatchObject({ ok: true, orphans: [] })
    expect(existsSync(eventLogFile({ sessionDir, threadId: CHILD }))).toBe(true)
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: CHILD }), schema: threadMetaSchema })
    expect(meta?.spawnerThreadId).toBeNull()
    expect(meta?.agentType).toBeNull()
  })

  it('keeps the ending that landed above the cut when the spawn sits below it', async () => {
    const fixture = await openOpsFixture()
    const { threadId } = await openDelegation({
      fixture,
      drafts: [said('delegate it'), spawned, said('msg_2'), agentEnded, said('msg_3')],
      referenced: false,
    })

    const result = await rewind(fixture, { threadId, toSeq: 3 })

    expect(result).toEqual({ ok: true, discarded: 1, kills: [], orphans: [] })
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
