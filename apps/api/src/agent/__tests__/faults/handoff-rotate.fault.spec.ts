import { EInputConsumed, type V2Event } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { EHostFault } from '../../testing/host-faults'
import type { HostProcess } from '../../testing/fault-rig'

const rowsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await ctx.record()).map((row) => row.event as V2Event)

const rotatedOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter((event) => event.type === 'rotated')

const consumedOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter(
    (event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Command,
  )

describeHandoff({
  name: 'a rotate command lands one rotated event across a host kill',
  prompt: 'say hello',

  async start(ctx): Promise<HostProcess> {
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [{ text: 'host a finished' }, { text: 'the handoff brief' }],
      },
      knobs: { fault: EHostFault.CommandOutcomeHangs },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the first turn to answer',
      check: async () => (await ctx.events()).some((row) => row.type === 'assistant-said'),
    })
    await waitUntil({
      what: 'host a to settle the first turn and release the session',
      check: async () => !(await ctx.rig.plane.currentLease({ sessionId: ctx.sessionId })).live,
    })
    await ctx.rig.plane.post({
      sessionId: ctx.sessionId,
      kind: 'command:rotate',
      payload: JSON.stringify({}),
    })
    await ctx.rig.wake(ctx.sessionId)
    await waitUntil({
      what: 'the rotate command to be consumed',
      check: async () => (await consumedOf(ctx)).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect((await rotatedOf(ctx)).length).toBeLessThanOrEqual(1)
    expect(await consumedOf(ctx)).toHaveLength(1)
  },

  async release() {},

  async settled(ctx) {
    await waitUntil({
      what: 'the rotation to land',
      check: async () => (await rotatedOf(ctx)).length >= 1,
    })
    expect(await rotatedOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return (await rotatedOf(ctx)).length
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the rotation to land after the pod restart',
      check: async () => (await rotatedOf(ctx)).length >= 1,
    })
    expect(await rotatedOf(ctx)).toHaveLength(1)
  },
})
