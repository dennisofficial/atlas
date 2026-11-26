import { expect } from 'bun:test'

import { EServiceRunStatus } from '@dltech/atlas-protocol'

import {
  dispatchesOf,
  interruptedOf,
  listeningCommandOf,
  podServices,
  resultOf,
  resultsOf,
  serviceStartCallOf,
  startedIdsOf,
} from './handoff-service-support'
import { PORT_BAND, portBandOf } from './fault-support'
import {
  describeHandoff,
  POD_EFFECT_WAIT_MS,
  waitUntil,
  type HandoffContext,
} from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const PORT = portBandOf(PORT_BAND.podOutage)
const SERVICE = 'a-listener-behind-an-outage'
const OUTAGE_MS = 4_000
const KNOBS = { plugins: true, pingMs: 500 }

const visiblyInterruptedOf = async (ctx: HandoffContext): Promise<readonly string[]> =>
  (await ctx.events())
    .filter((row) => /interrupt/i.test(JSON.stringify(row.event)))
    .map((row) => `${row.seq}:${row.type}`)

describeHandoff({
  name: 'a service start whose host handoff meets the pod link down',
  prompt: 'start the service',
  knobs: KNOBS,

  async start(ctx): Promise<HostProcess> {
    const command = listeningCommandOf({
      started: ctx.path('started'),
      runs: ctx.path('runs'),
      gate: ctx.gate('gate'),
    })
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: KNOBS,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              serviceStartCallOf({
                command,
                description: SERVICE,
                workdir: ctx.workspace,
                port: PORT,
              }),
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

  async beforeClaim(ctx) {
    ctx.daemon.proxy.set({ blackhole: true })
    setTimeout(() => {
      ctx.daemon.proxy.drop()
      ctx.daemon.proxy.clear()
    }, OUTAGE_MS)
  },

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    ctx.daemon.proxy.clear()
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the service call to report its real result',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await visiblyInterruptedOf(ctx)).toEqual([])

    const result = await resultOf(ctx)
    expect(result.error).toBeUndefined()
    const startedIds = await startedIdsOf(ctx)
    expect(startedIds).toHaveLength(1)
    const serviceId = result.output?.serviceId
    expect(serviceId).toBe(startedIds[0])
    if (serviceId === undefined) return

    await waitUntil({
      what: 'the pod to report the service ready',
      check: async () =>
        (await podServices(ctx)).some(
          (service) =>
            service.serviceId === serviceId && service.status === EServiceRunStatus.Ready,
        ),
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },
})
