import { afterEach, describe, expect, it } from 'bun:test'

import {
  loopCutNoticeDraft,
  toCallId,
  toRunId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { createLoopCut } from '../cut-loop'
import { RandomIds } from '../ids'
import { openStoreFixture, type StoreFixture } from './harness'

let fixture: StoreFixture

afterEach(async () => {
  await fixture.close()
})

const runId = toRunId('run-1')

const said = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const probeRound = (ordinal: number, input?: unknown, output?: unknown): EventDraft[] => [
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
    output: output ?? { exitCode: 0 },
    modelText: 'exit code 0',
  },
]

const openThread = async (drafts: readonly EventDraft[]): Promise<ThreadId> => {
  fixture = await openStoreFixture()
  const thread = await fixture.threads.create({ title: 'work' })
  await fixture.log.append({
    threadId: thread.id,
    runId,
    drafts: [{ type: 'user-said', text: 'work' }, ...drafts],
  })
  return thread.id
}

const cut = createLoopCut

describe('createLoopCut', () => {
  it('deletes the repeat suffix and appends the notice above the new head', async () => {
    const threadId = await openThread([...probeRound(1), ...probeRound(2), ...probeRound(3)])
    const apply = cut({ threads: fixture.threads, log: fixture.log, ids: new RandomIds() })

    const applied = await apply({
      threadId,
      toSeq: 4,
      throughSeq: 10,
      notice: loopCutNoticeDraft({ names: ['bash'], repeats: 2 }),
    })

    expect(applied).toBe(true)

    const events = await fixture.log.readOwn({ threadId })
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(events.at(-1)?.type).toBe('nudge')
    expect(await fixture.log.head({ threadId })).toBe(5)
  })

  it('declines when the log grew past the detected tail, leaving every row in place', async () => {
    const threadId = await openThread([...probeRound(1), ...probeRound(2), ...probeRound(3)])
    const apply = cut({ threads: fixture.threads, log: fixture.log, ids: new RandomIds() })

    const applied = await apply({
      threadId,
      toSeq: 4,
      throughSeq: 6,
      notice: loopCutNoticeDraft({ names: ['bash'], repeats: 2 }),
    })

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
    const threadId = await openThread([...started(1), ...started(2), ...started(3)])
    const apply = cut({ threads: fixture.threads, log: fixture.log, ids: new RandomIds() })

    const applied = await apply({
      threadId,
      toSeq: 4,
      throughSeq: 10,
      notice: loopCutNoticeDraft({ names: ['bash'], repeats: 2 }),
    })

    expect(applied).toBe(false)
    expect(await fixture.log.head({ threadId })).toBe(10)
  })

  it('declines a target the rewind rules refuse', async () => {
    const threadId = await openThread([...probeRound(1), ...probeRound(2), ...probeRound(3)])
    const apply = cut({ threads: fixture.threads, log: fixture.log, ids: new RandomIds() })

    const applied = await apply({
      threadId,
      toSeq: 99,
      throughSeq: 10,
      notice: loopCutNoticeDraft({ names: ['bash'], repeats: 2 }),
    })

    expect(applied).toBe(false)
    expect(await fixture.log.head({ threadId })).toBe(10)
  })
})
