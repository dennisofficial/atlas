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
  stopInPod,
} from './handoff-service-support'
import { PORT_BAND, portBandOf } from './fault-support'
import { describeHandoff, POD_EFFECT_WAIT_MS, waitUntil } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const PORT = portBandOf(PORT_BAND.serviceId)
const SERVICE = 'a-listener-killed-mid-start'

describeHandoff({
  name: 'a service start whose host is killed mid-operation',
  prompt: 'start the service',
  knobs: { plugins: true },

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
      knobs: { plugins: true },
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

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the service call to report its result',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)

    const result = await resultOf(ctx)
    const serviceId = result.output?.serviceId
    if (serviceId === undefined) throw new Error('the result named no service')

    const inPod = await podServices(ctx)
    expect(inPod).toHaveLength(1)
    const held = inPod[0]
    expect(held?.serviceId).toBe(serviceId)
    expect(held?.status).toBe(EServiceRunStatus.Ready)
    expect(await startedIdsOf(ctx)).toEqual([serviceId])

    await stopInPod({ ctx, serviceId })
    await waitUntil({
      what: 'the pod to report the service stopped',
      check: async () =>
        (await podServices(ctx)).some(
          (service) =>
            service.serviceId === serviceId && service.status === EServiceRunStatus.Stopped,
        ),
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },
})
