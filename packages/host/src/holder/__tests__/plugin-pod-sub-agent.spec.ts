import { describe, expect, it } from 'bun:test'

import { CallHandedOffError, toRunId, toThreadId } from '@dltech/atlas-core'
import { EMPTY_CREW, type PodSubAgent } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import { podAppendOf } from '../pod-append'
import type { SessionRuntime } from '../ports'
import { LeaseLostError } from '../record/lease-lost-error'
import type { SessionRecord } from '../record/record-adapter'

const deps = {
  sessionId: 'session-1',
  ids: { nextRunId: () => toRunId('run-1') },
} as unknown as HeldSessionDeps

const contextOf = (subAgent?: PodSubAgent) =>
  pluginPodContextOf({
    deps,
    runtime: {
      launchDirectory: '/work',
      remoteCalls: { onEvent: () => () => undefined },
    } as unknown as SessionRuntime,
    record: {} as SessionRecord,
    threadId: toThreadId('child-1'),
    signal: new AbortController().signal,
    crew: EMPTY_CREW,
    ...(subAgent === undefined ? {} : { subAgent }),
  })

describe('the sub-agent bookkeeping port', () => {
  it('is absent on the main context', () => {
    expect(contextOf().subAgent).toBeUndefined()
  })

  it('appends to the parent record using the parent thread id', async () => {
    const written: unknown[] = []
    const parent = {
      append: async (args: unknown) => {
        written.push(args)
      },
    } as unknown as SessionRecord
    const ctx = contextOf({
      agentId: 'child-1',
      appendToParent: podAppendOf({ record: parent, threadId: toThreadId('parent-1'), deps }),
    })
    const drafts = [
      { type: 'service-started', serviceId: 'svc-1', command: 'listen', agentId: 'child-1' },
    ] as const
    expect(ctx.subAgent?.agentId).toBe('child-1')
    await ctx.subAgent?.appendToParent(drafts)
    expect(written).toEqual([
      {
        threadId: 'parent-1',
        runId: 'run-1',
        drafts,
      },
    ])
  })

  it('reports a self-fenced parent append as handed off', async () => {
    const parent = {
      append: async () => {
        throw new LeaseLostError('handed off', 'self-fenced')
      },
    } as unknown as SessionRecord
    const ctx = contextOf({
      agentId: 'child-1',
      appendToParent: podAppendOf({ record: parent, threadId: toThreadId('parent-1'), deps }),
    })
    await expect(
      ctx.subAgent?.appendToParent([
        {
          type: 'service-started',
          serviceId: 'svc-1',
          command: 'listen',
          agentId: 'child-1',
        },
      ]),
    ).rejects.toBeInstanceOf(CallHandedOffError)
  })
})
