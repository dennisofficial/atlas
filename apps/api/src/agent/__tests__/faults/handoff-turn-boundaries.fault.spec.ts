import { ETurnEndedBy, ETurnOutcome, type V2Event } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { callIdOf, isDoneResult } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'

const boundariesOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await ctx.record())
    .map((row) => row.event as V2Event)
    .filter((event) => event.type === 'turn-started' || event.type === 'turn-ended')

const startsOf = async (ctx: HandoffContext) =>
  (await boundariesOf(ctx)).filter((event) => event.type === 'turn-started')

const endsOf = async (ctx: HandoffContext) =>
  (await boundariesOf(ctx)).filter((event) => event.type === 'turn-ended')

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const turnIdsOf = (events: readonly V2Event[]): Set<string> =>
  new Set(
    events.map((event) =>
      event.type === 'turn-started' || event.type === 'turn-ended' ? event.turnId : '',
    ),
  )

describeHandoff({
  name: 'a turn open across a handoff keeps one start and gets one end',
  prompt: 'run the gated command',

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const bash = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              { callId: CALL_ID, name: 'bash', input: { description: 'gated', command: bash } },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the turn to start',
      check: async () => (await startsOf(ctx)).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    return hostA
  },

  async inFlight(ctx) {
    expect(await startsOf(ctx)).toHaveLength(1)
    expect(await endsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the turn to end',
      check: async () => (await endsOf(ctx)).length >= 1,
    })
    const starts = await startsOf(ctx)
    const ends = await endsOf(ctx)
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(turnIdsOf(ends)).toEqual(turnIdsOf(starts))
    expect(ends[0]).toMatchObject({ outcome: ETurnOutcome.Completed, by: ETurnEndedBy.Agent })
    expect((await resultsOf(ctx)).filter(isDoneResult)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },
})
