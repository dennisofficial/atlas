import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  credentialRepairOf,
  EModelWaitCause,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type RunId,
  type ThreadId,
  type V2Body,
  type V2Event,
  type WaitingForModel,
} from '@dltech/atlas-core'
import type { LogEntry, LogPort } from '@dltech/atlas-observability'

import { modelWaitObserverOf } from '../model-wait-observer'
import { toRecordBody } from '../record/append-drafts'
import type { AppendBody, SessionRecord } from '../record/record-adapter'
import { RecordCache } from '../record/record-cache'
import { THREAD_ID } from './holder-rig'

const CHILD = toThreadId('thread-child-wait')
const RUN = 'run-wait' as RunId
const SESSION = 'session-wait'
const AT = '2026-11-06T12:00:00.000Z'

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
      visibleEvents: () =>
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

const recordOn = async (
  bodies: readonly V2Body[],
): Promise<{
  record: SessionRecord
  events: () => Promise<readonly V2Event[]>
}> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD_ID,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  const cache = await RecordCache.load({ plane, threadId: THREAD_ID })
  const write = async (next: readonly V2Body[]): Promise<void> => {
    const from = await plane.head({ threadId: THREAD_ID })
    const events = chainEvents({
      threadId: THREAD_ID,
      runId: RUN,
      epoch,
      at: AT,
      bodies: next,
      from,
    })
    const outcome = await plane.append({ threadId: THREAD_ID, epoch, events })
    if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
    cache.extend({ events, head: outcome.head })
  }
  await write(bodies)
  const record = {
    append: async (args: { threadId: ThreadId; drafts: readonly AppendBody[] }) =>
      write(args.drafts.map(toRecordBody)),
    eventCache: () => cache,
  } as unknown as SessionRecord
  const events = async (): Promise<readonly V2Event[]> => {
    const page = await plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 1000,
      visible: true,
    })
    return page.events
  }
  return { record, events }
}

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

  it('keeps the other threads of a shared wait waiting', async () => {
    const shared: WaitingForModel = { ...WAITING, affectedThreadIds: [THREAD_ID, CHILD] }
    const { record, events } = await recordOn([{ type: 'model-waiting', waiting: shared }])
    const observer = observerOn(record)

    await observer.admitted({ threadId: THREAD_ID })

    expect(observer.blocked({ threadId: THREAD_ID })).toBe(false)
    expect(observer.blocked({ threadId: CHILD })).toBe(true)

    const repair = credentialRepairOf({ mainThreadId: THREAD_ID, events: await events() })
    expect(repair?.main).toBe(false)
    expect(repair?.agents.map((agent) => agent.agentId)).toEqual([CHILD])

    await observer.admitted({ threadId: CHILD })

    expect(observer.blocked({ threadId: CHILD })).toBe(false)
    expect(credentialRepairOf({ mainThreadId: THREAD_ID, events: await events() })).toBeNull()
  })

  it('ignores a wait a rewind hid and observes the wait again', async () => {
    const { record, events } = await recordOn([
      { type: 'user-said', text: 'hello' },
      { type: 'model-waiting', waiting: WAITING },
      { type: 'history-rewound', toSeq: 1 },
    ])
    const observer = observerOn(record)

    expect(observer.blocked({ threadId: THREAD_ID })).toBe(false)

    await observer.observe({ threadId: THREAD_ID, waiting: WAITING })

    const recorded = await events()
    expect(recorded.filter((event) => event.type === 'model-waiting')).toHaveLength(1)
    expect(observer.blocked({ threadId: THREAD_ID })).toBe(true)
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
