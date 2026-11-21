import { ETurnEndedBy, ETurnOutcome, type V2Event } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const boundariesOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await ctx.record())
    .map((row) => row.event as V2Event)
    .filter((event) => event.type === 'turn-started' || event.type === 'turn-ended')

const startsOf = async (ctx: HandoffContext) =>
  (await boundariesOf(ctx)).filter((event) => event.type === 'turn-started')

const endsOf = async (ctx: HandoffContext) =>
  (await boundariesOf(ctx)).filter((event) => event.type === 'turn-ended')

const turnIdsOf = (events: readonly V2Event[]): Set<string> =>
  new Set(
    events.map((event) =>
      event.type === 'turn-started' || event.type === 'turn-ended' ? event.turnId : '',
    ),
  )

describeHandoff({
  name: 'one turn writes one start and one end across a handoff',
  prompt: 'answer once',

  async start(ctx): Promise<HostProcess> {
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: { [ctx.sessionId]: [{ text: 'host a finished' }] },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the first turn to end',
      check: async () => (await endsOf(ctx)).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await startsOf(ctx)).toHaveLength(1)
    expect(await endsOf(ctx)).toHaveLength(1)
  },

  async release() {},

  async settled(ctx) {
    await waitUntil({
      what: 'the turn boundaries to settle',
      check: async () => (await endsOf(ctx)).length >= 1,
    })
    const starts = await startsOf(ctx)
    const ends = await endsOf(ctx)
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(turnIdsOf(starts)).toEqual(turnIdsOf(ends))
    expect(ends[0]).toMatchObject({
      outcome: ETurnOutcome.Completed,
      by: ETurnEndedBy.Agent,
    })
  },

  async runs() {
    return 1
  },
})
