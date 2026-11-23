import { existsSync, readFileSync } from 'node:fs'

import { ENotifyMoment, ENotifyVerdict, EPendingWork } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const BG_CALL_ID = 'bg1'

const NOTIFY_FILE = 'notify.jsonl'

type NotifyRow = {
  sessionId: string
  threadId: string
  seq: number
  moment: string
  verdict: string
  holdMs: number
  pending: string[]
  operatorTurn: boolean
}

const notifyRowsOf = (ctx: HandoffContext): NotifyRow[] => {
  const path = ctx.paths[NOTIFY_FILE]
  if (path === undefined || !existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as NotifyRow)
}

const heldRowsOf = (ctx: HandoffContext): NotifyRow[] =>
  notifyRowsOf(ctx).filter((row) => row.verdict === ENotifyVerdict.Hold)

const sentRowsOf = (ctx: HandoffContext): NotifyRow[] =>
  notifyRowsOf(ctx).filter((row) => row.verdict === ENotifyVerdict.Send)

const rowsOf = async (args: {
  ctx: HandoffContext
  type: string
  callId?: string
}): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter(
    (row) =>
      row.type === args.type &&
      (args.callId === undefined || (row.event as { callId?: string }).callId === args.callId),
  )

const startedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-started' })

const endedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-ended' })

describeHandoff({
  name: 'a finished turn that holds its push while a background shell runs',
  prompt: 'start a long command in the background and finish the turn',
  knobs: { plugins: true, notifyLog: true },

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    ctx.path(NOTIFY_FILE)
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true, notifyLog: true },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: BG_CALL_ID,
                name: 'bash',
                input: { description: 'start the long command', command, background: true },
              },
            ],
          },
          { text: 'host a finished while the shell runs' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await ctx.waitFor('started', 30_000)
    await waitUntil({
      what: 'the turn to end with its held push',
      check: async () => heldRowsOf(ctx).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    const held = heldRowsOf(ctx)
    expect(held).toHaveLength(1)
    expect(held[0]?.holdMs).toBeGreaterThan(0)
    expect(held[0]?.pending).toEqual([EPendingWork.Shell])
    expect(held[0]?.moment).toBe(ENotifyMoment.TurnFinished)
    expect(held[0]?.operatorTurn).toBe(false)
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the shell end to wake a turn that sends without a hold',
      check: async () => sentRowsOf(ctx).length === 1,
    })
    const held = heldRowsOf(ctx)
    const sent = sentRowsOf(ctx)
    expect(held).toHaveLength(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.holdMs).toBe(0)
    expect(sent[0]?.pending).toEqual([])
    expect(sent[0]?.seq).toBeGreaterThan(held[0]?.seq ?? 0)
    expect(await endedRows(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    expect(heldRowsOf(ctx)).toHaveLength(1)
    expect(heldRowsOf(ctx)[0]?.holdMs).toBeGreaterThan(0)
    expect(await startedRows(ctx)).toHaveLength(1)
  },
})
