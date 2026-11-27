import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from 'bun:test'

import { ECallStatus, EServiceRunStatus } from '@dltech/atlas-protocol'

import { callIdOf, PORT_BAND, podCall, portBandOf } from './fault-support'
import {
  describeHandoff,
  POD_EFFECT_WAIT_MS,
  waitUntil,
  type HandoffContext,
} from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const DB_PORT = portBandOf(PORT_BAND.declaredDb)
const API_PORT = portBandOf(PORT_BAND.declaredApi)

type StartedRow = { name?: string; serviceId: string }

type ResultEvent = {
  output?: { started?: readonly { name: string; serviceId: string }[] }
  error?: { message: string }
  interrupted?: boolean
}

const SETUP_COMMAND = (args: { workspace: string; release: string }): string =>
  `echo setup >> ${args.workspace}/setup-runs; touch ${args.workspace}/setup-waiting; while [ ! -f ${args.release} ]; do sleep 0.05; done`

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

const declaredYaml = (args: { workspace: string; release: string }): string =>
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
    `      - ${SETUP_COMMAND({ workspace: args.workspace, release: args.release })}`,
    '',
  ].join('\n')

describeHandoff({
  name: 'a declared service that needs another, across a handoff',
  prompt: 'start the api',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    const release = ctx.path('setup-release')
    ctx.path('db-started')
    ctx.path('db-runs')
    ctx.path('api-runs')
    ctx.path('setup-runs')
    ctx.path('setup-waiting')
    mkdirSync(join(ctx.workspace, '.atlas'), { recursive: true })
    writeFileSync(
      join(ctx.workspace, '.atlas', 'services.yaml'),
      declaredYaml({ workspace: ctx.workspace, release }),
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
    await ctx.waitFor('db-started', POD_EFFECT_WAIT_MS)
    await ctx.waitFor('setup-waiting', POD_EFFECT_WAIT_MS)
    return hostA
  },

  async inFlight(ctx) {
    expect(await resultsOf(ctx)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },

  async release(ctx) {
    writeFileSync(ctx.path('setup-release'), '')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the declared start to report its real result',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: POD_EFFECT_WAIT_MS,
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
    const apiReported = reported.find((one) => one.name === 'api')
    expect(apiReported?.serviceId).toBe(api[0]?.serviceId)
    expect(reported.every((one) => one.serviceId !== db[0]?.serviceId)).toBe(true)

    expect(ctx.runCount('db-runs')).toBe(1)
    expect(ctx.runCount('api-runs')).toBe(1)
    expect(ctx.runCount('setup-runs')).toBe(1)

    const listed = await podCall({
      rig: ctx.rig,
      url: ctx.daemon.url,
      sessionId: ctx.sessionId,
      op: { op: 'services.list' },
    })
    if (listed.status !== ECallStatus.Ok || listed.op !== 'services.list') {
      throw new Error(`the pod refused to list its services: ${JSON.stringify(listed)}`)
    }
    const ready = listed.value.filter((service) => service.status === EServiceRunStatus.Ready)
    expect(ready.map((service) => service.serviceId)).toContain(api[0]?.serviceId ?? '')
    expect(ready.map((service) => service.serviceId)).toContain(db[0]?.serviceId ?? '')
  },

  async runs(ctx) {
    return ctx.runCount('api-runs')
  },
})
