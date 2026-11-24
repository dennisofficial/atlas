import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  type PodAnalytics,
  type PodAnalyticsRecord,
  type PodAnalyticsValue,
} from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

type Captured = { event: string; properties: Readonly<Record<string, PodAnalyticsValue>> }

const deps = {
  sessionId: 'session-1',
  ids: { nextRunId: () => toRunId('run-1') },
  bus: {},
} as unknown as HeldSessionDeps

const contextOf = (analytics: PodAnalytics | undefined) => {
  const runtime = {
    launchDirectory: '/work',
    ...(analytics === undefined ? {} : { analytics }),
  } as unknown as SessionRuntime
  return pluginPodContextOf({
    deps,
    runtime,
    record: {} as unknown as SessionRecord,
    threadId: toThreadId('thread-1'),
    signal: new AbortController().signal,
    crew: EMPTY_CREW,
  })
}

const recorder = (): { captured: Captured[]; analytics: PodAnalytics } => {
  const captured: Captured[] = []
  return {
    captured,
    analytics: {
      capture: (args) => captured.push(args),
    },
  }
}

describe('pluginPodContextOf analytics', () => {
  it('adds the session and the thread to every capture of the runtime analytics', () => {
    const { captured, analytics } = recorder()
    const ctx = contextOf(analytics)

    ctx.analytics.capture({
      event: 'quality review completed',
      properties: {
        status: 'completed',
        policies: [
          { policy_id: 'srp', outcome: 'clean', max_confidence: null },
        ] as readonly PodAnalyticsRecord[],
      },
    })

    expect(captured).toEqual([
      {
        event: 'quality review completed',
        properties: {
          status: 'completed',
          policies: [{ policy_id: 'srp', outcome: 'clean', max_confidence: null }],
          session_id: 'session-1',
          thread_id: 'thread-1',
        },
      },
    ])
  })

  it('answers with an empty capability, and no throw, when the runtime has no analytics', () => {
    const ctx = contextOf(undefined)
    expect(() => ctx.analytics.capture({ event: 'e', properties: { a: 1 } })).not.toThrow()
  })
})
