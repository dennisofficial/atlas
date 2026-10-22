import { afterEach, describe, expect, it } from 'bun:test'

import {
  loopCutNoticeDraft,
  toCallId,
  type EventDraft,
} from '@dltech/atlas-core'

import { createLoopCut } from '../cut-loop'
import { closeOpsFixtures, openOpsFixture, openThread, type OpsFixture } from './fixture'

afterEach(async () => {
  await closeOpsFixtures()
})

const said = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const probeRound = (ordinal: number, input?: unknown): EventDraft[] => [
  said(`checking ${ordinal}`),
  {
    type: 'tool-called',
    callId: toCallId(`call-${ordinal}`),
    name: 'bash',
    input: input ?? { command: 'git branch --show-current >/dev/null' },
    ordinal: 0,
  },
  {
    type: 'tool-result',
    callId: toCallId(`call-${ordinal}`),
    name: 'bash',
    output: { exitCode: 0 },
    modelText: 'exit code 0',
  },
]

const notice = loopCutNoticeDraft({ names: ['bash'], repeats: 2 })

const cut = (fixture: OpsFixture) =>
  createLoopCut({ log: fixture.log, registry: fixture.registry, clock: fixture.clock, ids: fixture.ids })

describe('createLoopCut over the sessions store', () => {
  it('deletes the repeat suffix and appends the notice above the new head', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({
      fixture,
      drafts: [{ type: 'user-said', text: 'work' }, ...probeRound(1), ...probeRound(2), ...probeRound(3)],
    })

    const applied = await cut(fixture)({ threadId, toSeq: 4, throughSeq: 10, notice })

    expect(applied).toBe(true)
    const events = await fixture.log.readOwn({ threadId })
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(events.at(-1)?.type).toBe('nudge')
    expect(await fixture.log.head({ threadId })).toBe(5)
  })

  it('declines when the log grew past the detected tail, leaving every line in place', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({
      fixture,
      drafts: [{ type: 'user-said', text: 'work' }, ...probeRound(1), ...probeRound(2), ...probeRound(3)],
    })

    const applied = await cut(fixture)({ threadId, toSeq: 4, throughSeq: 6, notice })

    expect(applied).toBe(false)
    expect(await fixture.log.head({ threadId })).toBe(10)
  })

  it('declines rather than destroy a creation the range turns out to hold', async () => {
    const started = (ordinal: number): EventDraft[] => [
      said(`starting ${ordinal}`),
      {
        type: 'tool-called',
        callId: toCallId(`call-${ordinal}`),
        name: 'bash',
        input: { command: 'bun test', runInBackground: true },
        ordinal: 0,
      },
      {
        type: 'tool-result',
        callId: toCallId(`call-${ordinal}`),
        name: 'bash',
        output: { shellId: `bash_${ordinal}` },
        modelText: `started bash_${ordinal}`,
      },
    ]
    const fixture = await openOpsFixture()
    const threadId = await openThread({
      fixture,
      drafts: [{ type: 'user-said', text: 'work' }, ...started(1), ...started(2), ...started(3)],
    })

    const applied = await cut(fixture)({ threadId, toSeq: 4, throughSeq: 10, notice })

    expect(applied).toBe(false)
    expect(await fixture.log.head({ threadId })).toBe(10)
  })

  it('declines a target the rewind rules refuse', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({
      fixture,
      drafts: [{ type: 'user-said', text: 'work' }, ...probeRound(1), ...probeRound(2), ...probeRound(3)],
    })

    const applied = await cut(fixture)({ threadId, toSeq: 99, throughSeq: 10, notice })

    expect(applied).toBe(false)
    expect(await fixture.log.head({ threadId })).toBe(10)
  })

  it('serializes the whole read-verify-rewrite against a concurrent append', async () => {
    const fixture = await openOpsFixture()
    const threadId = await openThread({
      fixture,
      drafts: [{ type: 'user-said', text: 'work' }, ...probeRound(1), ...probeRound(2), ...probeRound(3)],
    })

    const [applied] = await Promise.all([
      cut(fixture)({ threadId, toSeq: 4, throughSeq: 10, notice }),
      fixture.log.append({
        threadId,
        runId: fixture.ids.nextRunId(),
        drafts: [{ type: 'user-said', text: 'meanwhile' }],
      }),
    ])

    expect(applied).toBe(true)
    const events = await fixture.log.readOwn({ threadId })
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(events[4]?.type).toBe('nudge')
    expect(events[5]?.type).toBe('user-said')
    expect(await fixture.log.head({ threadId })).toBe(6)
  })
})
