import { expect } from 'bun:test'

import { EShellEndCause } from '@dltech/atlas-core'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'
import { postMessage } from './settle-fault-support'

const rowsOf = async (args: { ctx: HandoffContext; type: string }): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter((row) => row.type === args.type)

const endedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-ended' })

const turnsStarted = (ctx: HandoffContext) => rowsOf({ ctx, type: 'turn-started' })

const restartThePod = async (ctx: HandoffContext): Promise<void> => {
  await ctx.daemon.restart({ keepHome: true })
  await postMessage({
    rig: ctx.rig,
    sessionId: ctx.sessionId,
    text: 'the pod restarted, are things back?',
  })
  await ctx.rig.wake(ctx.sessionId)
}

describeHandoff({
  name: 'a background shell whose pod restarts after the turn ended',
  prompt: 'start a long command in the background and end your turn',
  knobs: { plugins: true },
  takeOverScripts: ({ sessionId }) => ({
    [sessionId]: [
      { text: 'the pod restarted, so the shell went with it and I will start it again later' },
      { text: 'nothing more to do' },
    ],
  }),

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: 'shell1',
                name: 'bash',
                input: { description: 'wait for the gate', command, background: true },
              },
            ],
          },
          { text: 'started it, ending the turn' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await ctx.waitFor('started', 30_000)
    await waitUntil({
      what: 'the turn to end with only the shell left open',
      check: async () => (await rowsOf({ ctx, type: 'turn-ended' })).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await endedRows(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await restartThePod(ctx)
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the agent to wake on the ending the restarted pod left and end that turn',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    const ended = await endedRows(ctx)
    expect(ended).toHaveLength(1)
    expect(ended[0]?.event).toMatchObject({ cause: EShellEndCause.PodRestarted })
    expect((await turnsStarted(ctx)).length).toBeGreaterThanOrEqual(2)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the agent to wake on the ending of the shell the restarted pod lost',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    const ended = await endedRows(ctx)
    expect(ended).toHaveLength(1)
    expect(ended[0]?.event).toMatchObject({ cause: EShellEndCause.PodRestarted })
  },
})
