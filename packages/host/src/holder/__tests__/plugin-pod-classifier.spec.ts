import { describe, expect, it } from 'bun:test'

import {
  EClassifierFault,
  toRunId,
  toThreadId,
  type ClassifierPort,
  type ClassifierStatus,
} from '@dltech/atlas-core'
import { EMPTY_CREW } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

const contextOf = (args: { classifier: ClassifierPort; classifierStatus: ClassifierStatus }) => {
  const deps = {
    sessionId: 'session-1',
    ids: { nextRunId: () => toRunId('run-1') },
    bus: {},
  } as unknown as HeldSessionDeps
  const runtime = {
    launchDirectory: '/work',
    classifier: args.classifier,
    classifierStatus: args.classifierStatus,
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

describe('pluginPodContextOf classifier', () => {
  it('reports the runtime status, off with its reason when the session has no classifier', () => {
    const ctx = contextOf({
      classifier: {
        classify: async () => ({
          ok: false,
          fault: EClassifierFault.Unavailable,
          detail: 'v1 has no classifier',
        }),
      },
      classifierStatus: { on: false, reason: 'v1 has no classifier' },
    })

    expect(ctx.classifier.status()).toEqual({ on: false, reason: 'v1 has no classifier' })
  })

  it('delegates classify to the runtime classifier', async () => {
    const seen: unknown[] = []
    const ctx = contextOf({
      classifier: {
        classify: async () => {
          seen.push('called')
          return { ok: true, answers: { danger: { noul: 0.2 } }, model: 'jev-latest' }
        },
      },
      classifierStatus: { on: true, model: 'jev-latest', provider: 'jev' },
    })

    const outcome = await ctx.classifier.classify({
      state: 'the state',
      questions: { danger: { type: 'noul', instructions: 'Is this risky?' } },
      signal: new AbortController().signal,
    })

    expect(seen).toEqual(['called'])
    expect(outcome).toEqual({
      ok: true,
      answers: { danger: { noul: 0.2 } },
      model: 'jev-latest',
    })
    expect(ctx.classifier.status()).toEqual({ on: true, model: 'jev-latest', provider: 'jev' })
  })
})
