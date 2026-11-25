import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'

import { callIdOf, daemonCall } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const DB_PORT = 44_000 + (process.pid % 500)
const API_PORT = DB_PORT + 500

type StartedRow = { name?: string; serviceId: string }

type ResultEvent = {
  output?: { started?: readonly { name: string; serviceId: string }[] }
  error?: { message: string }
  interrupted?: boolean
}

let probeCount = 0

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const resultOf = async (ctx: HandoffContext): Promise<ResultEvent> => {
  const [first] = await resultsOf(ctx)
  if (first === undefined) throw new Error('the declared start reported no result')
  return first.event as ResultEvent
}

const startedRowsOf = async (ctx: HandoffContext): Promise<readonly StartedRow[]> =>
  (await ctx.record())
    .filter((row) => row.type === 'service-started')
    .map((row) => row.event as StartedRow)

const servedOf = async (ctx: HandoffContext, port: number): Promise<boolean> => {
  try {
    const answer = await fetch(`http://127.0.0.1:${port}/`)
    await answer.arrayBuffer()
    return answer.ok
  } catch {
    return false
  }
}

const declaredYaml = (args: { workspace: string; gate: string }): string =>
  [
    'services:',
    '  db:',
    '    command: |',
    `      touch ${args.workspace}/db-started; echo run >> ${args.workspace}/db-runs; exec bun -e 'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("db") })'`,
    `    port: ${DB_PORT}`,
    '  api:',
    '    command: |',
    `      echo run >> ${args.workspace}/api-runs; exec bun -e 'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("api") })'`,
    `    port: ${API_PORT}`,
    '    needs:',
    '      - db',
    '    setup:',
    `      - cat ${args.gate}`,
    '',
  ].join('\n')

describeHandoff({
  name: 'a declared service that needs another, across a handoff',
  prompt: 'start the api',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    const gate = ctx.gate('gate')
    ctx.path('db-started')
    ctx.path('db-runs')
    ctx.path('api-runs')
    mkdirSync(join(ctx.workspace, '.atlas'), { recursive: true })
    writeFileSync(
      join(ctx.workspace, '.atlas', 'services.yaml'),
      declaredYaml({ workspace: ctx.workspace, gate }),
    )
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
                callId: CALL_ID,
                name: 'service',
                input: { action: 'start', name: 'api', readyTimeoutMs: 60_000 },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the declared start to be dispatched',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await ctx.waitFor('db-started', 30_000)
    return hostA
  },

  async inFlight(ctx) {
    expect(await resultsOf(ctx)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the declared start to report its real result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const result = await resultOf(ctx)
    expect(result.interrupted).toBeUndefined()
    expect(result.error).toBeUndefined()

    const started = await startedRowsOf(ctx)
    const db = started.filter((row) => row.name === 'db')
    const api = started.filter((row) => row.name === 'api')
    expect(db).toHaveLength(1)
    expect(api).toHaveLength(1)

    const reported = result.output?.started ?? []
    expect(reported.map((one) => one.name)).toEqual(['db', 'api'])
    expect(reported[0]?.serviceId).toBe(db[0]?.serviceId)
    expect(reported[1]?.serviceId).toBe(api[0]?.serviceId)

    expect(ctx.runCount('api-runs')).toBe(1)
    expect(ctx.runCount('db-runs')).toBe(1)

    await waitUntil({
      what: 'the api to serve on its declared port',
      check: () => servedOf(ctx, API_PORT),
    })

    probeCount += 1
    const held = await ctx.rig.plane.currentLease({ sessionId: ctx.sessionId })
    const listed = await daemonCall({
      url: ctx.daemon.url,
      sessionId: ctx.sessionId,
      epoch: held.lease.epoch,
      key: `${ctx.sessionId}.declared-${probeCount}`,
      op: { op: 'services.list' },
    })
    if (listed.status !== ECallStatus.Ok || listed.op !== 'services.list') {
      throw new Error(`the pod refused to list its services: ${JSON.stringify(listed)}`)
    }
    const ids = listed.value.map((service) => service.serviceId)
    expect(ids).toContain(db[0]?.serviceId ?? '')
    expect(ids).toContain(api[0]?.serviceId ?? '')
  },

  async runs(ctx) {
    return ctx.runCount('api-runs')
  },
})
