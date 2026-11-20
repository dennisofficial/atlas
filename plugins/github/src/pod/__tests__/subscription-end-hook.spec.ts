import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EPrEventKind,
  ESubscriptionActor,
  ESubscriptionEnd,
  toRunId,
  toThreadId,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type V2Body,
} from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'

import { githubPod } from '..'

type Drafts = readonly (EventDraft | RecordBody | PluginEventBody)[]

const rig = (bodies: V2Body[]) => {
  const append = async (drafts: Drafts): Promise<void> => {
    for (const draft of drafts) bodies.push(draft as V2Body)
  }
  const ctx: PluginPodContext = {
    control: podControlStub,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    sessionId: 's1',
    append,
    events: () =>
      chainEvents({
        threadId: toThreadId('t1'),
        runId: toRunId('r1'),
        epoch: 1,
        at: '2026-11-08T10:00:00.000Z',
        bodies,
      }),
    call: async () => {
      throw new Error('the ending hook makes no call')
    },
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
  return { ctx, bodies }
}

const CREATED: V2Body = {
  type: 'subscription-created',
  subscriptionId: 'a',
  provider: 'github.pull-request',
  target: { repo: 'github.com/o/r', number: 4 },
  label: 'o/r#4',
  createdBy: ESubscriptionActor.Agent,
}

const MERGED: V2Body = {
  type: 'pr-event',
  repo: 'github.com/o/r',
  prNumber: 4,
  kind: EPrEventKind.State,
  url: 'https://github.com/o/r/pull/4',
  state: 'merged',
}

const ENDING = {
  type: 'subscription-ended',
  subscriptionId: 'a',
  reason: ESubscriptionEnd.Completed,
  by: ESubscriptionActor.Provider,
} as const

const of = (rigged: ReturnType<typeof rig>) => {
  const hooks = githubPod.hooks?.(rigged.ctx)
  if (hooks === undefined) throw new Error('no hooks')
  return { beforeTurn: hooks.beforeTurn?.[0], afterTurn: hooks.afterTurn?.[0] }
}

describe('subscription end hook', () => {
  it('drafts the ending at the turn boundary the terminal event woke', async () => {
    const rigged = rig([CREATED, MERGED])
    const { beforeTurn } = of(rigged)
    if (beforeTurn === undefined) throw new Error('no beforeTurn hook')

    const outcome = await beforeTurn.run({
      threadId: toThreadId('t1'),
      projectDirectory: '/tmp/project',
    })
    expect(outcome.drafts).toEqual([ENDING])
  })

  it('drafts nothing once the ending is in the journal', async () => {
    const rigged = rig([CREATED, MERGED])
    const { beforeTurn, afterTurn } = of(rigged)
    if (beforeTurn === undefined || afterTurn === undefined) throw new Error('no hook')

    await rigged.ctx.append([
      (
        await beforeTurn.run({
          threadId: toThreadId('t1'),
          projectDirectory: '/tmp/project',
        })
      ).drafts?.[0] as EventDraft,
    ])

    const closing = await afterTurn.run({ threadId: toThreadId('t1') })
    expect(closing.drafts ?? []).toEqual([])
  })

  it('drafts nothing while the pull request is open', async () => {
    const rigged = rig([CREATED, { ...MERGED, state: 'open' }])
    const { beforeTurn } = of(rigged)
    if (beforeTurn === undefined) throw new Error('no beforeTurn hook')

    const outcome = await beforeTurn.run({
      threadId: toThreadId('t1'),
      projectDirectory: '/tmp/project',
    })
    expect(outcome.drafts ?? []).toEqual([])
  })
})
