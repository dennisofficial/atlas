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
import { describeHandoff, waitUntil } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const PORT = 42_000 + (process.pid % 1_000)
const SERVICE = 'a-gated-listener'

describeHandoff({
  name: 'a service start that outlives the turn',
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

    await waitUntil({
      what: 'the pod to report the service it was asked for',
      check: async () =>
        (await podServices(ctx)).some(
          (service) =>
            service.serviceId === serviceId && service.status === EServiceRunStatus.Ready,
        ),
    })

    await stopInPod({ ctx, serviceId })
    await waitUntil({
      what: 'the pod to report the service stopped',
      check: async () =>
        (await podServices(ctx)).some(
          (service) =>
            service.serviceId === serviceId && service.status === EServiceRunStatus.Stopped,
        ),
    })
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
