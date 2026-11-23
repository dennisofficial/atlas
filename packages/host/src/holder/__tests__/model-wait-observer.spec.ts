import { describe, expect, it } from 'bun:test'

import {
  EModelWaitCause,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type RunId,
  type ThreadId,
  type V2Event,
  type WaitingForModel,
} from '@dltech/atlas-core'
import type { LogEntry, LogPort } from '@dltech/atlas-observability'

import { modelWaitObserverOf } from '../model-wait-observer'
import type { AppendBody, SessionRecord } from '../record/record-adapter'
import { THREAD_ID } from './holder-rig'

const CHILD = toThreadId('thread-child-wait')
const RUN = 'run-wait' as RunId

const WAITING: WaitingForModel = {
  episode: {
    kind: EWaitEpisodeKind.Credential,
    key: {
      accountId: toAccountId('account-1'),
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
    },
    generation: 1,
  },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'account-1',
  modelId: 'claude-sonnet-4-5',
  reason: null,
  resetAt: null,
  affectedThreadIds: [THREAD_ID],
}

type Appended = { threadId: ThreadId; drafts: readonly AppendBody[] }

type FakeRecord = {
  record: SessionRecord
  appended: Appended[]
  failAppends(): void
}

const isWaitingDraft = (
  draft: AppendBody,
): draft is Extract<AppendBody, { type: 'model-waiting' | 'model-wait-cleared' }> =>
  draft.type === 'model-waiting' || draft.type === 'model-wait-cleared'

const fakeRecordOf = (): FakeRecord => {
  const appended: Appended[] = []
  let failing = false
  const record = {
    append: async (args: { threadId: ThreadId; drafts: readonly AppendBody[] }) => {
      if (failing) throw new Error('the holder self-fenced')
      appended.push({ threadId: args.threadId, drafts: [...args.drafts] })
      return []
    },
    eventCache: () => ({
      eventsAfter: () =>
        appended.flatMap((entry) =>
          entry.drafts
            .filter(isWaitingDraft)
            .map((draft) => ({ ...draft, threadId: entry.threadId }) as unknown as V2Event),
        ),
    }),
  } as unknown as SessionRecord
  return { record, appended, failAppends: () => (failing = true) }
}

const observerOn = (record: SessionRecord) =>
  modelWaitObserverOf({ record, threadId: THREAD_ID, newRunId: () => RUN })

const drafted = (appended: readonly Appended[]): readonly AppendBody[] =>
  appended.flatMap((entry) => entry.drafts)

describe('modelWaitObserverOf', () => {
  it('records one model-waiting for a blocked step and clears it once', async () => {
    const { record, appended } = fakeRecordOf()
    const observer = observerOn(record)

    await observer.observe({ threadId: THREAD_ID, waiting: WAITING })
    await observer.observe({ threadId: THREAD_ID, waiting: WAITING })

    expect(drafted(appended)).toEqual([{ type: 'model-waiting', waiting: WAITING }])
    expect(observer.blocked({ threadId: THREAD_ID })).toBe(true)
    expect(observer.blocked({ threadId: CHILD })).toBe(false)

    await observer.admitted({ threadId: THREAD_ID })
    await observer.admitted({ threadId: THREAD_ID })

    expect(drafted(appended)).toEqual([
      { type: 'model-waiting', waiting: WAITING },
      { type: 'model-wait-cleared', episode: WAITING.episode, cause: WAITING.cause },
    ])
    expect(observer.blocked({ threadId: THREAD_ID })).toBe(false)
  })

  it('records a sub-agent wait on the parent thread, scoped to the sub-agent', async () => {
    const { record, appended } = fakeRecordOf()
    const observer = observerOn(record)

    await observer.observe({
      threadId: CHILD,
      waiting: { ...WAITING, affectedThreadIds: [CHILD] },
    })

    expect(appended.map((entry) => entry.threadId)).toEqual([THREAD_ID])
    expect(appended[0]?.drafts).toEqual([
      { type: 'model-waiting', waiting: { ...WAITING, affectedThreadIds: [CHILD] } },
    ])
    expect(observer.blocked({ threadId: CHILD })).toBe(true)
    expect(observer.blocked({ threadId: THREAD_ID })).toBe(false)

    await observer.admitted({ threadId: CHILD })

    expect(drafted(appended).filter((draft) => draft.type === 'model-wait-cleared')).toHaveLength(1)
    expect(observer.blocked({ threadId: CHILD })).toBe(false)
  })

  it('records ids, provider, model and reason, and no secret', async () => {
    const { record, appended } = fakeRecordOf()
    const observer = observerOn(record)

    await observer.observe({ threadId: THREAD_ID, waiting: WAITING })
    await observer.admitted({ threadId: THREAD_ID })

    const json = JSON.stringify(drafted(appended))
    expect(json).toContain('account-1')
    expect(json).toContain('anthropic')
    expect(json).not.toContain('sk-')
    expect(json).not.toContain('Bearer')
  })

  it('logs a failed append and keeps the turn outcome', async () => {
    const { record, appended, failAppends } = fakeRecordOf()
    const logged: LogEntry[] = []
    const log = { error: (entry: LogEntry) => logged.push(entry) } as unknown as LogPort
    const observer = modelWaitObserverOf({ record, threadId: THREAD_ID, newRunId: () => RUN, log })
    failAppends()

    await observer.observe({ threadId: THREAD_ID, waiting: WAITING })
    await observer.admitted({ threadId: THREAD_ID })

    expect(appended).toEqual([])
    expect(logged.map((entry) => entry.source)).toEqual(['holder.model-wait'])
    expect(logged[0]?.message).toBe('a model wait could not be recorded')
  })
})
