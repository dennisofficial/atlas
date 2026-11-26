import { describe, expect, it } from 'bun:test'

import {
  EEffort,
  latchFactOf,
  refKey,
  toRunId,
  toThreadId,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
} from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { EMPTY_CREW } from '@dltech/atlas-plugin-sdk'

import { runInCallScope } from '../../calls/call-scope'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { RoleModelChoice, SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

const T0 = '2026-11-09T10:00:00.000Z'
const SPAWNER = { sessionId: 's1', mainThreadId: 't1', userId: 'u1', projectId: 'p1' }
const SCOPE = 'hfeedbeefdeadbeef'

const FELL_BACK: RoleModelChoice = {
  ref: { providerId: 'openai', modelId: 'gpt-5' },
  effort: EEffort.High,
  fast: false,
  unavailable: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
}

type Captured = EventDraft | RecordBody | PluginEventBody

const fakeRecordOf = () => {
  const drafts: Captured[] = []
  const facts: { key: string; kind: string; value: unknown }[] = []
  const record = {
    append: async (args: { drafts: readonly Captured[] }) => {
      drafts.push(...args.drafts)
      for (const draft of args.drafts) {
        if (draft.type === 'fact-recorded') {
          facts.push({ key: draft.key, kind: draft.kind, value: draft.value })
        }
      }
    },
    eventCache: () => ({
      eventsAfter: () => drafts,
      bookkeeping: () => ({
        fact: (key: string) => {
          const found = facts.find((fact) => fact.key === key)
          return found === undefined ? { found: false } : { found: true, value: found.value }
        },
        factsWithPrefix: (prefix: string) => facts.filter((fact) => fact.key.startsWith(prefix)),
      }),
    }),
  }
  return { record, drafts, facts }
}

const contextOf = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  const { record, drafts, facts } = fakeRecordOf()
  const deps = {
    sessionId: SPAWNER.sessionId,
    plane,
    ids: { nextRunId: () => toRunId('run-1') },
    bus: {},
  } as unknown as HeldSessionDeps
  const runtime = {
    launchDirectory: '/work',
    modelChoice: FELL_BACK,
    choiceFor: () => FELL_BACK,
    modelLabelOf: (ref: { providerId: string; modelId: string }) => refKey(ref),
  } as unknown as SessionRuntime
  const ctx = pluginPodContextOf({
    deps,
    runtime,
    record: record as unknown as SessionRecord,
    threadId: toThreadId(SPAWNER.mainThreadId),
    signal: new AbortController().signal,
    crew: EMPTY_CREW,
  })
  return { plane, ctx, drafts, facts }
}

const inScope = async (body: () => Promise<void>): Promise<void> =>
  await runInCallScope({ scopeKey: SCOPE, body })

describe('pluginPodContextOf on a replayed call', () => {
  it('appends the teammate fallback to the record once', async () => {
    const { plane, ctx, drafts, facts } = await contextOf()
    const spawn = async () =>
      await inScope(async () => {
        await ctx.sessions.spawn({ title: 'the peer', brief: 'read the port' })
      })
    await spawn()
    await spawn()
    expect(drafts.filter((draft) => draft.type === 'model-fell-back')).toHaveLength(1)
    expect(facts.filter((fact) => fact.kind === 'effect-started').map((fact) => fact.key)).toEqual([
      `${SCOPE}.0`,
    ])
    const roster = await plane.sessionsOf({ sessionId: SPAWNER.sessionId })
    expect(
      roster.sessions.filter((row) => row.spawnedBySessionId === SPAWNER.sessionId),
    ).toHaveLength(1)
  })

  it('appends a fact the record already holds once, and other drafts every time', async () => {
    const { ctx, drafts } = await contextOf()
    const fact = { type: 'fact-recorded' as const, key: 'probe:a', kind: 'probe', value: 1 }
    await ctx.append([fact])
    await ctx.append([fact])
    await ctx.append([{ type: 'idle-released', inboxHead: 1 }])
    await ctx.append([{ type: 'idle-released', inboxHead: 1 }])
    expect(drafts.filter((draft) => draft.type === 'fact-recorded')).toHaveLength(1)
    expect(drafts.filter((draft) => draft.type === 'idle-released')).toHaveLength(2)
  })

  it('appends a fact that rewrites its key to a new value, so a latch re-arms', async () => {
    const { ctx, drafts } = await contextOf()
    await ctx.append([latchFactOf({ name: 'memory-nudge', level: 1 })])
    await ctx.append([latchFactOf({ name: 'memory-nudge', level: 0 })])
    await ctx.append([latchFactOf({ name: 'memory-nudge', level: 1 })])
    await ctx.append([latchFactOf({ name: 'memory-nudge', level: 1 })])
    const levels = drafts.flatMap((draft) => (draft.type === 'fact-recorded' ? [draft.value] : []))
    expect(levels).toEqual([1, 0, 1])
  })

  it('posts a notice once for a repeated key', async () => {
    const { plane, ctx } = await contextOf()
    const event = {
      type: 'agent-reported' as const,
      agentId: toThreadId('agent-1'),
      agentType: 'general-purpose',
      intent: 'read the port',
      prose: 'done',
    }
    await ctx.notify(event, { key: 'service-ended:box-1' })
    await ctx.notify(event, { key: 'service-ended:box-1' })
    expect(
      await plane.readInbox({ sessionId: SPAWNER.sessionId, afterId: 0, limit: 50 }),
    ).toHaveLength(1)
  })
})
