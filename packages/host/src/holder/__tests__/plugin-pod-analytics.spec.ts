import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import { EAgentStatus, toRunId, toThreadId } from '@dltech/atlas-core'
import {
  EAnalyticsLinks,
  EAnalyticsThreadKind,
  EMPTY_CREW,
  type PodAnalytics,
  type PodAnalyticsRecord,
  type PodAnalyticsValue,
  type PodCrew,
} from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import { analyticsOf, hashedLinkOf, threadKindOf } from '../pod-analytics'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

type Captured = {
  event: string
  properties: Readonly<Record<string, PodAnalyticsValue>>
  links?: EAnalyticsLinks | undefined
}

const deps = {
  sessionId: 'session-1',
  ids: { nextRunId: () => toRunId('run-1') },
  bus: {},
} as unknown as HeldSessionDeps

const contextOf = (args: {
  analytics: PodAnalytics | undefined
  selfAgentId?: string | undefined
  crew?: PodCrew | undefined
}) => {
  const runtime = {
    launchDirectory: '/work',
    ...(args.analytics === undefined ? {} : { analytics: args.analytics }),
  } as unknown as SessionRuntime
  return pluginPodContextOf({
    deps,
    runtime,
    record: {} as unknown as SessionRecord,
    threadId: toThreadId('thread-1'),
    signal: new AbortController().signal,
    crew: args.crew ?? EMPTY_CREW,
    ...(args.selfAgentId === undefined ? {} : { selfAgentId: args.selfAgentId }),
  })
}

const crewWith = (agent: { agentId: string; agentType: string }): PodCrew => ({
  ...EMPTY_CREW,
  list: () => [
    {
      ...agent,
      intent: 'port the sidebar',
      status: EAgentStatus.Running,
      turns: 0,
      toolCalls: 0,
      startedAt: '2026-11-25T00:00:00.000Z',
    },
  ],
})

const recorder = (): { captured: Captured[]; analytics: PodAnalytics } => {
  const captured: Captured[] = []
  return {
    captured,
    analytics: {
      capture: (args) => captured.push(args),
    },
  }
}

const expectedHash = (id: string): string =>
  createHash('sha256').update(id).digest('hex').slice(0, 16)

describe('pluginPodContextOf analytics', () => {
  it('adds the session and the thread to a capture that asks for raw links', () => {
    const { captured, analytics } = recorder()
    const ctx = contextOf({ analytics })

    ctx.analytics.capture({
      event: 'quality review completed',
      properties: {
        status: 'completed',
        policies: [
          { policy_id: 'srp', verdict: 'clean', max_concern: null },
        ] as readonly PodAnalyticsRecord[],
      },
    })

    expect(captured).toEqual([
      {
        event: 'quality review completed',
        properties: {
          status: 'completed',
          policies: [{ policy_id: 'srp', verdict: 'clean', max_concern: null }],
          session_id: 'session-1',
          thread_id: 'thread-1',
        },
      },
    ])
  })

  it('replaces raw ids with hashes and the thread kind when a capture asks for hashed links', () => {
    const { captured, analytics } = recorder()
    const ctx = contextOf({ analytics })

    ctx.analytics.capture({
      event: 'quality review completed',
      properties: { status: 'completed' },
      links: EAnalyticsLinks.Hashed,
    })

    expect(captured[0]?.properties).toEqual({
      status: 'completed',
      session_hash: expectedHash('session-1'),
      thread_hash: expectedHash('thread-1'),
      thread_kind: 'main',
    })
    expect(captured[0]?.properties).not.toHaveProperty('session_id')
    expect(captured[0]?.properties).not.toHaveProperty('thread_id')
  })

  it('answers with an empty capability, and no throw, when the runtime has no analytics', () => {
    const ctx = contextOf({ analytics: undefined })
    expect(() => ctx.analytics.capture({ event: 'e', properties: { a: 1 } })).not.toThrow()
  })

  it('names a sub-agent thread', () => {
    const { captured, analytics } = recorder()
    const ctx = contextOf({
      analytics,
      selfAgentId: 'agent-1',
      crew: crewWith({ agentId: 'agent-1', agentType: 'builder' }),
    })

    ctx.analytics.capture({ event: 'e', properties: {}, links: EAnalyticsLinks.Hashed })

    expect(captured[0]?.properties.thread_kind).toBe('sub_agent')
  })

  it('names a teammate thread', () => {
    const { captured, analytics } = recorder()
    const ctx = contextOf({
      analytics,
      selfAgentId: 'agent-1',
      crew: crewWith({ agentId: 'agent-1', agentType: 'teammate' }),
    })

    ctx.analytics.capture({ event: 'e', properties: {}, links: EAnalyticsLinks.Hashed })

    expect(captured[0]?.properties.thread_kind).toBe('teammate')
  })
})

describe('threadKindOf', () => {
  it('calls the root thread main', () => {
    expect(threadKindOf({ agents: [] })).toBe(EAnalyticsThreadKind.Main)
  })

  it('calls a child the crew lists as a teammate a teammate', () => {
    expect(
      threadKindOf({
        selfAgentId: 'agent-1',
        agents: [{ agentId: 'agent-1', agentType: 'teammate' }],
      }),
    ).toBe(EAnalyticsThreadKind.Teammate)
  })

  it('calls any other child a sub-agent', () => {
    expect(
      threadKindOf({
        selfAgentId: 'agent-1',
        agents: [{ agentId: 'agent-1', agentType: 'explore' }],
      }),
    ).toBe(EAnalyticsThreadKind.SubAgent)
  })

  it('calls a child the crew does not list yet a sub-agent', () => {
    expect(threadKindOf({ selfAgentId: 'agent-2', agents: [] })).toBe(EAnalyticsThreadKind.SubAgent)
  })
})

describe('hashedLinkOf', () => {
  it('takes the first 16 hex characters of the SHA-256 of the id', () => {
    expect(hashedLinkOf({ id: 'thread-1' })).toBe(expectedHash('thread-1'))
    expect(hashedLinkOf({ id: 'thread-1' })).toHaveLength(16)
  })
})

describe('analyticsOf without a thread kind', () => {
  it('sends hashed links without a thread kind when the caller cannot name one', () => {
    const captured: Captured[] = []
    const analytics = analyticsOf({
      analytics: { capture: (args) => captured.push(args) },
      sessionId: 'session-1',
      threadId: toThreadId('thread-1'),
    })
    analytics.capture({ event: 'probe', properties: {}, links: EAnalyticsLinks.Hashed })
    expect(captured[0]?.properties).toEqual({
      session_hash: expectedHash('session-1'),
      thread_hash: expectedHash('thread-1'),
    })
  })
})
