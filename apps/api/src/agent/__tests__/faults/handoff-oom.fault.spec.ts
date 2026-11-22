import { EOomScope } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const KILLS = 3

const OOM_EVENTS = `printf 'oom 1\\noom_kill ${KILLS}\\n' > "$ATLAS_WORKLOAD_CGROUP/w-$$/memory.events"`

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const incidentsOf = async (ctx: HandoffContext) =>
  (await ctx.record()).filter((row) => row.type === 'pod-ran-out-of-memory')

const isOomResult = (row: { event: unknown }): boolean => {
  const output = (row.event as { output?: unknown }).output
  if (typeof output !== 'object' || output === null) return false
  return (output as { oomKilled?: unknown }).oomKilled === true
}

const isInterrupted = (row: { event: unknown }): boolean =>
  (row.event as { interrupted?: unknown }).interrupted === true

describeHandoff({
  name: 'a bash call that the kernel kills for memory',
  prompt: 'balloon the memory then say done',

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const bash = `${OOM_EVENTS}; touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              { callId: CALL_ID, name: 'bash', input: { description: 'balloon', command: bash } },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the bash call to be dispatched',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    return hostA
  },

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
    expect(await incidentsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the bash call to report its end',
      check: async () => (await resultsOf(ctx)).filter(isOomResult).length === 1,
    })
    const incidents = await incidentsOf(ctx)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]?.event).toMatchObject({
      type: 'pod-ran-out-of-memory',
      scope: EOomScope.Command,
      processes: KILLS,
    })
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the bash result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    expect((await resultsOf(ctx)).filter(isInterrupted)).toHaveLength(1)
    expect(await incidentsOf(ctx)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },
})
