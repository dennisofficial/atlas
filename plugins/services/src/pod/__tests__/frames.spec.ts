import { describe, expect, it } from 'bun:test'

import { EKilledBy, EServiceStatus } from '@dltech/atlas-core'
import { EServiceRunStatus, type DaemonEventFrame, type ServiceInfo } from '@dltech/atlas-protocol'

import { recordServiceFrame } from '../frames'
import { stateFor } from '../state'
import { invoke, rig, serviceIdOf, settle } from './support'

const info = (overrides: Partial<ServiceInfo>): ServiceInfo => ({
  serviceId: 'svc-x',
  command: 'listen',
  pid: 1,
  port: null,
  status: EServiceRunStatus.Exited,
  exitCode: 0,
  signal: null,
  startedAt: 1,
  ...overrides,
})

const endedFrame = (overrides: Partial<ServiceInfo>): DaemonEventFrame => ({
  kind: 'event',
  event: {
    type: 'services.ended',
    serviceId: overrides.serviceId ?? 'svc-x',
    info: info(overrides),
  },
})

const readyFrame = (serviceId: string): DaemonEventFrame => ({
  kind: 'event',
  event: { type: 'services.ready', serviceId },
})

const record = (harness: ReturnType<typeof rig>, frame: DaemonEventFrame) =>
  recordServiceFrame({ ctx: harness.ctx, state: stateFor(harness.ctx), frame })

const started = async (harness: ReturnType<typeof rig>, command = 'listen') =>
  serviceIdOf(
    await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', description: 'web', command },
    }),
  )

describe('recordServiceFrame', () => {
  it('appends service-ready once for a repeated frame', async () => {
    const harness = rig()
    await record(harness, readyFrame('svc-x'))
    await record(harness, readyFrame('svc-x'))
    expect(harness.log).toMatchObject([{ type: 'service-ready', serviceId: 'svc-x' }])
  })

  it('does not append a ready the journal already holds', async () => {
    const harness = rig()
    await harness.ctx.append([{ type: 'service-ready', serviceId: 'svc-x' }])
    await record(harness, readyFrame('svc-x'))
    expect(harness.log).toHaveLength(1)
  })

  it('appends one ended event with the mapped status and the started description', async () => {
    const harness = rig()
    const serviceId = await started(harness)
    const frame = endedFrame({ serviceId, exitCode: 3 })
    await record(harness, frame)
    await record(harness, frame)
    expect(harness.notices).toMatchObject([
      {
        event: {
          serviceId,
          command: 'listen',
          description: 'web',
          status: EServiceStatus.Exited,
          exitCode: 3,
          tail: '',
        },
        key: `service-ended:${serviceId}`,
      },
    ])
    expect(harness.log.filter((event) => event.type === 'service-ended')).toHaveLength(0)
  })

  it('reads the tail from services.log', async () => {
    const harness = rig()
    const serviceId = await started(harness, 'echo hello; listen')
    await record(harness, endedFrame({ serviceId }))
    expect(harness.notices.at(-1)?.event).toMatchObject({
      type: 'service-ended',
      tail: 'hello\n',
    })
  })

  it('keeps an empty tail when services.log fails', async () => {
    const harness = rig()
    await harness.ctx.append([
      { type: 'service-started', serviceId: 'svc-x', command: 'listen', description: 'web' },
    ])
    await record(harness, endedFrame({ serviceId: 'svc-x' }))
    expect(harness.notices.at(-1)?.event).toMatchObject({ type: 'service-ended', tail: '' })
  })

  it('maps a stop to a kill', async () => {
    const harness = rig()
    const serviceId = await started(harness)
    await record(
      harness,
      endedFrame({ serviceId, status: EServiceRunStatus.Stopped, exitCode: null }),
    )
    expect(harness.notices.at(-1)?.event).toMatchObject({
      status: EServiceStatus.Killed,
      killedBy: EKilledBy.Unrecorded,
    })
  })

  it('a service that ran out of memory ends as out of memory with the command limit', async () => {
    const memory = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }
    const harness = rig()
    const serviceId = await started(harness)
    await record(
      harness,
      endedFrame({ serviceId, status: EServiceRunStatus.OomKilled, exitCode: 137, memory }),
    )
    expect(harness.notices.at(-1)?.event).toMatchObject({
      type: 'service-ended',
      status: EServiceStatus.Killed,
      killedBy: EKilledBy.OutOfMemory,
      exitCode: 137,
      memory,
    })
  })

  it('skips an ending the journal already holds', async () => {
    const harness = rig()
    const serviceId = await started(harness)
    await harness.ctx.append([
      {
        type: 'service-ended',
        serviceId,
        command: 'listen',
        status: EServiceStatus.Exited,
        tail: '',
      },
    ])
    await record(harness, endedFrame({ serviceId }))
    expect(harness.notices).toHaveLength(0)
  })

  it('records an ending whose start the journal never held, from the daemon', async () => {
    const harness = rig()
    await record(harness, endedFrame({ serviceId: 'svc-lost', command: 'serve --port 80' }))
    expect(harness.notices).toMatchObject([
      { event: { type: 'service-ended', serviceId: 'svc-lost', command: 'serve --port 80' } },
    ])
  })

  it('orders an ending that races its start append after the start', async () => {
    const harness = rig()
    harness.ctx.onDaemonEvent((frame) => {
      void recordServiceFrame({ ctx: harness.ctx, state: stateFor(harness.ctx), frame })
    })
    const serviceId = await started(harness, 'echo done')
    await settle()
    expect(harness.log.map((event) => event.type)).toEqual(['service-started'])
    expect(harness.notices[0]?.event).toMatchObject({
      serviceId,
      tail: 'done\n',
      status: EServiceStatus.Exited,
    })
  })
})
