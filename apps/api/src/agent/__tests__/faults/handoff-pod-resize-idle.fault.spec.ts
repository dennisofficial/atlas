import { existsSync, readFileSync } from 'node:fs'

import { expect } from 'bun:test'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const CALL_ID = 'bg1'
const POD_RESIZE_FILE = 'pod-resize.jsonl'

type ResizeRow = {
  taskId: string
  idempotencyKey: string
  payload: {
    sessionId: string
    generation: number
    whenIdle?: boolean
    waitedSince?: string
  }
}

const waits = new Map<string, { generation: number; since: string }>()

const rowsOf = async (args: { ctx: HandoffContext; type: string }): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter((row) => row.type === args.type)

const startedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-started' })

const endedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-ended' })

const resizeRowsOf = (ctx: HandoffContext): ResizeRow[] => {
  const path = ctx.paths[POD_RESIZE_FILE]
  if (path === undefined || !existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as ResizeRow)
}

const waitOf = (ctx: HandoffContext): { generation: number; since: string } => {
  const wait = waits.get(ctx.sessionId)
  if (wait === undefined) throw new Error('the scenario never recorded a waiting resize')
  return wait
}

const expectOneResizeOfTheWait = (ctx: HandoffContext): void => {
  const wait = waitOf(ctx)
  const rows = resizeRowsOf(ctx)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.taskId).toBe('pod-resize')
  expect(rows[0]?.idempotencyKey).toBe(
    `pod-resize:${ctx.sessionId}:${wait.generation}:idle:${wait.since}`,
  )
  expect(rows[0]?.payload.whenIdle).toBe(true)
  expect(Date.parse(rows[0]?.payload.waitedSince ?? '')).toBe(Date.parse(wait.since))
}

const recordWaitingResize = async (ctx: HandoffContext): Promise<void> => {
  const generation = await ctx.rig.plane.recordPodDesired({
    sessionId: ctx.sessionId,
    vcpus: 4,
    memoryGb: 8,
  })
  const since = new Date().toISOString()
  const waiting = await ctx.rig.plane.recordPodWaiting({
    sessionId: ctx.sessionId,
    generation,
    since,
  })
  expect(waiting).toBe(true)
  waits.set(ctx.sessionId, { generation, since })
}

describeHandoff({
  name: 'a resize that waits for a background shell to finish',
  prompt: 'start a long command in the background and finish the turn',
  knobs: { plugins: true, podResizeLog: true },

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    ctx.path(POD_RESIZE_FILE)
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true, podResizeLog: true },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
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
      what: 'the turn to end with its shell still running',
      check: async () => (await rowsOf({ ctx, type: 'turn-ended' })).length === 1,
    })
    await recordWaitingResize(ctx)
    return hostA
  },

  async inFlight(ctx) {
    const session = await ctx.rig.plane.readSession({ sessionId: ctx.sessionId })
    expect(Date.parse(session?.podWaitingSince ?? '')).toBe(Date.parse(waitOf(ctx).since))
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(0)
    expect(resizeRowsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the idle edge to dispatch the waiting resize',
      check: async () => resizeRowsOf(ctx).length === 1,
    })
    await waitUntil({
      what: 'the shell ending to reach the record',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    expectOneResizeOfTheWait(ctx)
    expect(await startedRows(ctx)).toHaveLength(1)
    const settled = new Set(resizeRowsOf(ctx).map((row) => row.idempotencyKey))
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(new Set(resizeRowsOf(ctx).map((row) => row.idempotencyKey))).toEqual(settled)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the lost shell to dispatch the waiting resize',
      check: async () => resizeRowsOf(ctx).length === 1,
      timeoutMs: 60_000,
    })
    expectOneResizeOfTheWait(ctx)
  },
})
