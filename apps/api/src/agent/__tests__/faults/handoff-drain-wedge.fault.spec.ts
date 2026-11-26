import { expect } from 'bun:test'

import { DRAIN_STREAM_ABORT_CAP_MS } from '@dltech/atlas-host'

import type { HostKnobs, HostProcess, ReadEvent } from '../../testing/fault-rig'
import { EHostFault } from '../../testing/host-faults'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'

const CALL_ID = 'call-drain-wedge'
const NAME = 'task_write'
const DRAIN_CAP_MS = 3_000
const EXIT_MARGIN_MS = 5_000
const HUNG = 'fault: tool-result append hangs'
const ORDER = { tasks: [{ text: 'hold the append', activeForm: 'holding the append' }] }
const KNOBS: HostKnobs = { drainCapMs: DRAIN_CAP_MS }

const rowsOf = (ctx: HandoffContext): Promise<ReadEvent[]> => ctx.record()

const rowsWithCallOf = async (args: {
  ctx: HandoffContext
  type: 'tool-dispatched' | 'tool-result'
}): Promise<ReadEvent[]> =>
  (await rowsOf(args.ctx)).filter((row) => row.type === args.type && callIdOf(row) === CALL_ID)

const saidsOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'assistant-said')

const nudgesOf = (rows: readonly ReadEvent[]): ReadEvent[] =>
  rows.filter((row) => row.type === 'nudge')

const textOf = (row: ReadEvent): string =>
  JSON.stringify((row.event as { parts?: unknown }).parts ?? [])

const finishedText = 'host b finished'

const timedHosts = new Map<string, { host: HostProcess; signalledForMs(): number | undefined }>()

const timedHost = (
  host: HostProcess,
): { host: HostProcess; signalledForMs(): number | undefined } => {
  let signalledAt: number | undefined
  let exitedAt: number | undefined
  const wrapped: HostProcess = {
    ...host,
    kill(signal) {
      signalledAt = Date.now()
      host.kill(signal)
    },
    exited: host.exited.then((code) => {
      exitedAt = Date.now()
      return code
    }),
  }
  return {
    host: wrapped,
    signalledForMs: () =>
      signalledAt === undefined || exitedAt === undefined ? undefined : exitedAt - signalledAt,
  }
}

describeHandoff({
  name: 'a host-side tool whose result append never settles',
  prompt: 'write the task list',
  knobs: KNOBS,

  async start(ctx): Promise<HostProcess> {
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { ...KNOBS, fault: EHostFault.ToolResultHangs },
      scripts: {
        [ctx.sessionId]: [{ calls: [{ callId: CALL_ID, name: NAME, input: ORDER }] }],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the task_write call to be dispatched',
      check: async () => (await rowsWithCallOf({ ctx, type: 'tool-dispatched' })).length === 1,
    })
    await waitUntil({
      what: 'the tool-result append to hang',
      check: async () => hostA.logs().some((line) => line.includes(HUNG)),
    })
    expect(await rowsWithCallOf({ ctx, type: 'tool-result' })).toEqual([])
    const timed = timedHost(hostA)
    timedHosts.set(ctx.sessionId, timed)
    return timed.host
  },

  async inFlight(ctx) {
    const signalledForMs = timedHosts.get(ctx.sessionId)?.signalledForMs()
    expect(signalledForMs).toBeLessThanOrEqual(
      DRAIN_CAP_MS + DRAIN_STREAM_ABORT_CAP_MS + EXIT_MARGIN_MS,
    )
  },

  async release(): Promise<void> {},

  async settled(ctx) {
    await waitUntil({
      what: `${finishedText} to be said`,
      check: async () =>
        saidsOf(await rowsOf(ctx)).some((row) => textOf(row).includes(finishedText)),
    })
    const rows = await rowsOf(ctx)
    expect(
      rows.filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID),
    ).toHaveLength(1)
    expect(nudgesOf(rows)).toEqual([])
  },

  async runs(ctx) {
    return (await rowsWithCallOf({ ctx, type: 'tool-result' })).length
  },
})
