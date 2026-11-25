import { expect } from 'bun:test'

import { ECallStatus, EServiceRunStatus, type ServiceInfo } from '@dltech/atlas-protocol'

import { callIdOf, daemonCall } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const PORT = 42_000 + (process.pid % 1_000)
const SERVICE = 'a-gated-listener'

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const interruptedOf = (row: { event: unknown }): boolean => {
  const event = row.event as { interrupted?: boolean; error?: { message: string } }
  if (event.interrupted === true) return true
  return event.error !== undefined && /interrupt/i.test(event.error.message)
}

type ResultEvent = {
  output?: { serviceId?: string }
  error?: { message: string }
}

const resultOf = async (ctx: HandoffContext): Promise<ResultEvent> => {
  const [first] = await resultsOf(ctx)
  if (first === undefined) throw new Error('the service call reported no result')
  return first.event as ResultEvent
}

const startedIdsOf = async (ctx: HandoffContext): Promise<readonly string[]> =>
  (await ctx.record())
    .filter((row) => row.type === 'service-started')
    .map((row) => (row.event as { serviceId: string }).serviceId)

let probeCount = 0

const podCall = async (ctx: HandoffContext, op: Parameters<typeof daemonCall>[0]['op']) => {
  probeCount += 1
  const held = await ctx.rig.plane.currentLease({ sessionId: ctx.sessionId })
  return daemonCall({
    url: ctx.daemon.url,
    sessionId: ctx.sessionId,
    epoch: held.lease.epoch,
    key: `${ctx.sessionId}.probe-${probeCount}`,
    op,
  })
}

const podServices = async (ctx: HandoffContext): Promise<readonly ServiceInfo[]> => {
  const listed = await podCall(ctx, { op: 'services.list' })
  if (listed.status !== ECallStatus.Ok || listed.op !== 'services.list') {
    throw new Error(`the pod refused to list its services: ${JSON.stringify(listed)}`)
  }
  return listed.value
}

describeHandoff({
  name: 'a service start that outlives the turn',
  prompt: 'start the service',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; exec bun -e 'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("ok") })'`
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
                input: {
                  action: 'start',
                  command,
                  description: SERVICE,
                  workdir: ctx.workspace,
                  port: PORT,
                  readyTimeoutMs: 60_000,
                },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the service call to be dispatched',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    return hostA
  },

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the service call to report its real result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)

    const result = await resultOf(ctx)
    expect(result.error).toBeUndefined()
    const startedIds = await startedIdsOf(ctx)
    expect(startedIds).toHaveLength(1)
    const serviceId = result.output?.serviceId
    expect(serviceId).toBe(startedIds[0])
    if (serviceId === undefined) return

    const listed = await podServices(ctx)
    expect(listed.map((service) => service.serviceId)).toContain(serviceId)
    expect(listed.find((service) => service.serviceId === serviceId)?.status).toBe(
      EServiceRunStatus.Ready,
    )

    const stopped = await podCall(ctx, { op: 'services.stop', serviceId })
    expect(stopped.status).toBe(ECallStatus.Ok)
    const after = await podServices(ctx)
    expect(after.find((service) => service.serviceId === serviceId)?.status).toBe(
      EServiceRunStatus.Stopped,
    )
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the service result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },
})
