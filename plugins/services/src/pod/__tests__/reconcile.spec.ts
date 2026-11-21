import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellEndCause, EServiceStatus } from '@dltech/atlas-core'

import { reconcileServices } from '../reconcile'
import { stateFor } from '../state'
import { rig } from './support'

const startedService = async (harness: ReturnType<typeof rig>, serviceId = 'svc-1') => {
  await harness.ctx.append([
    { type: 'service-started', serviceId, command: 'bun dev', description: 'web', bootId: 'b1' },
  ])
  return serviceId
}

const reconcile = async (harness: ReturnType<typeof rig>) => {
  await reconcileServices({ ctx: harness.ctx, state: stateFor(harness.ctx) })
}

describe('reconciling open services when a host takes the session over', () => {
  it('writes nothing when the record holds no open service', async () => {
    const harness = rig()
    await reconcile(harness)
    expect(harness.calls.filter((op) => op.op === 'services.list')).toHaveLength(0)
    expect(harness.notices).toHaveLength(0)
  })

  it('ends a service the sandbox does not know, quietly', async () => {
    const harness = rig()
    const serviceId = await startedService(harness)
    await reconcile(harness)
    expect(harness.notices).toEqual([
      {
        event: {
          type: 'service-ended',
          serviceId,
          command: 'bun dev',
          description: 'web',
          bootId: 'b1',
          status: EServiceStatus.Killed,
          killedBy: EKilledBy.Unrecorded,
          cause: EShellEndCause.SandboxStopped,
          tail: '',
        },
        key: `service-ended:${serviceId}`,
      },
    ])
  })

  it('writes one ending when two takeovers reconcile the same lost service', async () => {
    const harness = rig()
    await startedService(harness)
    await reconcile(harness)
    await reconcile(harness)
    expect(harness.notices).toHaveLength(1)
  })

  it('does not settle a service whose ending the record already holds', async () => {
    const harness = rig()
    const serviceId = await startedService(harness)
    await harness.ctx.append([
      {
        type: 'service-ended',
        serviceId,
        command: 'bun dev',
        status: EServiceStatus.Exited,
        tail: '',
      },
    ])
    await reconcile(harness)
    expect(harness.notices).toHaveLength(0)
  })

  it('runs once from the hooks a takeover registers', async () => {
    const harness = rig()
    const serviceId = await startedService(harness)
    const { servicesPod } = await import('..')
    servicesPod.hooks?.(harness.ctx)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.notices.at(-1)?.event).toMatchObject({
      type: 'service-ended',
      serviceId,
      cause: EShellEndCause.SandboxStopped,
    })
  })
})
