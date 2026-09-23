import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'

import {
  EAgentStart,
  ECompactionAnchor,
  ECompactionRefusal,
  eventBodySchema,
  toCallId,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { ECompactionFailure, type Summarise } from '../../../compact'
import { newThreadMeta, writeMeta } from '../../meta'
import { eventLogFile, sessionDirectory, threadMetaFile } from '../../paths'
import { compactThread } from '../compact'
import { closeOpsFixtures, openOpsFixture, openThread, type OpsFixture } from './fixture'

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
  input: { command: 'ls' },
  ordinal: 0,
}
const resulted: EventDraft = {
  type: 'tool-result',
  callId: toCallId('call-1'),
  name: 'bash',
  output: { ok: true },
}
const granted: EventDraft = eventBodySchema.parse({
  type: 'permission-granted',
  grantId: 'grant-1',
  dimensions: ['contention'],
  scope: 'thread',
  subject: 'worktree:eng-412-sidebar',
  reason: 'the operator chose to stop being asked about this',
})

const summarises = (summary: string | null): Summarise => async () => summary

const mark = (
  fixture: OpsFixture,
  args: { threadId: ThreadId; anchor?: ECompactionAnchor; seq: number; summary: string | null; destructive: boolean },
) =>
  compactThread({
    log: fixture.log,
    registry: fixture.registry,
    clock: fixture.clock,
    ids: fixture.ids,
    agents: fixture.agents,
    threadId: args.threadId,
    anchor: args.anchor ?? ECompactionAnchor.Prefix,
    seq: args.seq,
    destructive: args.destructive,
    summarise: summarises(args.summary),
  })

const shapeOf = async (fixture: OpsFixture, threadId: ThreadId) =>
  (await fixture.log.read({ threadId })).map((event) => [event.seq, event.type])

const OPENING = [said('one'), replied('two'), said('three'), replied('four')]

describe('compactThread over the sessions store', () => {
  it('appends the watermark past the head and regenerates every id', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: OPENING })
    const originalIds = (await fixture.log.read({ threadId })).map((event) => event.id)

    const outcome = await mark(fixture, { threadId, seq: 2, summary: 'the opening', destructive: false })

    expect(outcome).toEqual({
      ok: true,
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 2,
      replaced: 2,
      summary: 'the opening',
    })
    const events = await fixture.log.read({ threadId })
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'user-said'],
      [2, 'assistant-said'],
      [3, 'user-said'],
      [4, 'assistant-said'],
      [5, 'history-compacted'],
    ])
    for (const event of events) expect(originalIds.includes(event.id)).toBe(false)
    const watermark = events.at(-1)
    expect(watermark?.type === 'history-compacted' && watermark.summary).toBe('the opening')
    expect(watermark?.type === 'history-compacted' && watermark.replaced).toBe(2)
  })

  it('replaces the range with the summary standing in its place when destructive', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: OPENING })

    await mark(fixture, { threadId, seq: 2, summary: 'the opening', destructive: true })

    expect(await shapeOf(fixture, threadId)).toEqual([
      [1, 'history-compacted'],
      [2, 'user-said'],
      [3, 'assistant-said'],
    ])
  })

  it('spares a grant from a destructive summary and seats the summary beside it', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: [said('clean it'), granted, said('and again'), replied('done')] })

    const outcome = await mark(fixture, { threadId, seq: 3, summary: 'the cleanup', destructive: true })

    expect(outcome.ok === true && outcome.replaced).toBe(2)
    expect(await shapeOf(fixture, threadId)).toEqual([
      [1, 'permission-granted'],
      [2, 'history-compacted'],
      [3, 'assistant-said'],
    ])
  })

  it('replaces the tail when asked to summarise from a point', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: OPENING })

    await mark(fixture, { threadId, anchor: ECompactionAnchor.Suffix, seq: 3, summary: 'the closing', destructive: true })

    expect(await shapeOf(fixture, threadId)).toEqual([
      [1, 'user-said'],
      [2, 'assistant-said'],
      [3, 'history-compacted'],
    ])
  })

  it('refuses a prefix that would orphan a tool result and never asks the summariser', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: [said('clean it'), called, resulted] })
    let asked = false

    const outcome = await compactThread({
      log: fixture.log,
      registry: fixture.registry,
      clock: fixture.clock,
      ids: fixture.ids,
      agents: fixture.agents,
      threadId,
      anchor: ECompactionAnchor.Prefix,
      seq: 2,
      summarise: async () => {
        asked = true
        return 'a summary'
      },
    })

    expect(outcome).toMatchObject({ ok: false, failure: ECompactionFailure.Refused, refusal: ECompactionRefusal.SplitsToolCall })
    expect(asked).toBe(false)
    expect((await fixture.log.read({ threadId })).length).toBe(3)
  })

  it('changes nothing when the summariser comes back empty', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({ fixture, drafts: OPENING })

    const outcome = await mark(fixture, { threadId, seq: 2, summary: null, destructive: false })

    expect(outcome).toMatchObject({ ok: false, failure: ECompactionFailure.NoSummary })
    expect((await fixture.log.read({ threadId })).length).toBe(4)
  })

  it('deletes the files of delegations the destroyed range created', async () => {
    const fixture = await openOpsFixture()
    const child = toThreadId('brn_child')
    const spawned: EventDraft = {
      type: 'agent-spawned',
      agentId: child,
      agentType: 'explore',
      intent: 'find the callers',
      mode: EAgentStart.Fresh,
    }
    const threadId = await openThread({ fixture, drafts: [said('delegate it'), spawned, replied('spawned one')] })
    const sessionDir = sessionDirectory({ home: fixture.home, sessionId: threadId })
    await writeMeta({
      file: threadMetaFile({ sessionDir, threadId: child }),
      meta: {
        ...newThreadMeta({ id: child, at: fixture.clock.now() }),
        spawnerThreadId: threadId,
        agentType: 'explore',
      },
    })
    fixture.registry.registerThread({ sessionDir, threadId: child })
    await fixture.log.append({ threadId: child, runId: fixture.ids.nextRunId(), drafts: [said('child work')] })

    const outcome = await mark(fixture, { threadId, seq: 3, summary: 'the delegation', destructive: true })

    expect(outcome.ok).toBe(true)
    expect(existsSync(eventLogFile({ sessionDir, threadId: child }))).toBe(false)
    expect(existsSync(threadMetaFile({ sessionDir, threadId: child }))).toBe(false)
    expect(await shapeOf(fixture, threadId)).toEqual([[1, 'history-compacted']])
  })
})
