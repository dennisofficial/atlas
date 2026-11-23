import { expect } from 'bun:test'

import { ERunFailureKind } from '@dltech/atlas-core'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'
import { callIdOf } from './fault-support'

const CALL_ID = 'c1'

const dispatchedOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const authFailuresOf = async (ctx: HandoffContext) =>
  (await ctx.record()).filter(
    (row) =>
      row.type === 'run-failed' &&
      (row.event as { failure?: { kind?: string } }).failure?.kind === ERunFailureKind.Auth,
  )

const saidOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'assistant-said')

const turnStartsOf = async (ctx: HandoffContext) =>
  (await ctx.record()).filter((row) => row.type === 'turn-started')

describeHandoff({
  name: 'a credential failure the operator retries',
  prompt: 'run it',
  prepared: true,

  async start(ctx): Promise<HostProcess> {
    const runs = ctx.path('runs')
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'bash',
                input: { description: 'quick', command: `echo run >> ${runs}; echo done` },
              },
            ],
          },
          { throws: { fault: 'auth', message: 'invalid x-api-key' } },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the bash call to run and the next model step to fail on the key',
      check: async () => (await authFailuresOf(ctx)).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await authFailuresOf(ctx)).toHaveLength(1)
    expect(await dispatchedOf(ctx)).toHaveLength(1)
    expect(await saidOf(ctx)).toHaveLength(0)
    expect(await turnStartsOf(ctx)).toHaveLength(1)
  },

  async release(ctx) {
    await ctx.rig.plane.post({ sessionId: ctx.sessionId, kind: 'retry', payload: '{}' })
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the retried turn to answer',
      check: async () => (await saidOf(ctx)).length === 1,
    })
    expect(await dispatchedOf(ctx)).toHaveLength(1)
    expect(await authFailuresOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await ctx.rig.plane.post({ sessionId: ctx.sessionId, kind: 'retry', payload: '{}' })
    await waitUntil({
      what: 'the retried turn to answer once the pod is back',
      check: async () => (await saidOf(ctx)).length === 1,
    })
    expect(await dispatchedOf(ctx)).toHaveLength(1)
  },
})
