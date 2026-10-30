import { describe, expect, it } from 'bun:test'

import { EKilledBy, EServiceStatus, type Event } from '@dltech/atlas-core'

import { EEnsureStatus } from '../declared-ensure'
import { resumeDeclaredServices } from '../declared-resume'
import { declaredServicesToResume } from '../service-resume'
import { open, THREAD } from './declared-fixture'

describe('ensureDeclared', () => {
  it('starts declared services in order and reports urls and readiness', async () => {
    const { registry, processes } = open()

    const result = await registry.ensureDeclared({ threadId: THREAD })

    expect(result.map((one) => [one.name, one.status, one.ready])).toEqual([
      ['web', EEnsureStatus.Started, true],
      ['worker', EEnsureStatus.Started, true],
    ])
    expect(result[0]?.url).toStartWith('https://')
    expect(result[1]?.url).toBeUndefined()
    const started = processes.servicesStarted()
    expect(started.map((one) => one.cmd[2])).toEqual(['serve web', 'run worker'])
    expect(started[1]?.env?.PORT).toBe('24500')
    expect(started[0]?.env?.PUBLIC_URL).toStartWith('https://')
    await registry.closeAll()
  })

  it('is idempotent: a running service is not started twice', async () => {
    const { registry, processes } = open()
    await registry.ensureDeclared({ threadId: THREAD })

    const again = await registry.ensureDeclared({ threadId: THREAD })

    expect(again.map((one) => one.status)).toEqual([EEnsureStatus.Running, EEnsureStatus.Running])
    expect(processes.servicesStarted()).toHaveLength(2)
    await registry.closeAll()
  })

  it('dedupes concurrent ensures', async () => {
    const { registry, processes } = open()

    await Promise.all([
      registry.ensureDeclared({ threadId: THREAD }),
      registry.ensureDeclared({ threadId: THREAD }),
    ])

    expect(processes.servicesStarted()).toHaveLength(2)
    await registry.closeAll()
  })

  it('flags a service that never answers as not ready but still returns its url', async () => {
    const { registry } = open({ probeExit: 7 })

    const [web] = await registry.ensureDeclared({ threadId: THREAD, names: ['web'] })

    expect(web?.ready).toBe(false)
    expect(web?.url).toStartWith('https://')
    expect(web?.reason).toContain('not accepting connections')
    await registry.closeAll()
  })

  it('probes the health path with curl and falls back to TCP without one', async () => {
    const { registry, processes } = open()
    await registry.ensureDeclared({ threadId: THREAD })

    const probes = processes.spawned.filter(
      (one) => one.cmd[0] === 'curl' || one.cmd[2]?.startsWith('exec 3<>'),
    )
    expect(probes.some((one) => one.cmd.at(-1)?.endsWith('/up'))).toBe(true)
    expect(probes.some((one) => one.cmd[2] === 'exec 3<>/dev/tcp/127.0.0.1/24500')).toBe(true)
    await registry.closeAll()
  })

  it('reports unknown names', async () => {
    const { registry } = open()

    const result = await registry.ensureDeclared({ threadId: THREAD, names: ['nope'] })

    expect(result[0]).toMatchObject({ name: 'nope', status: EEnsureStatus.Unknown, ready: false })
  })

  it('restarts a stopped declared service on the next ensure', async () => {
    const { registry, processes } = open()
    await registry.ensureDeclared({ threadId: THREAD, names: ['worker'] })
    const first = registry.list()[0]
    registry.stop({ serviceId: first?.serviceId ?? '', by: EKilledBy.Model })
    await Bun.sleep(20)

    const again = await registry.ensureDeclared({ threadId: THREAD, names: ['worker'] })

    expect(again[0]?.status).toBe(EEnsureStatus.Started)
    expect(processes.servicesStarted()).toHaveLength(2)
    expect(registry.list().filter((one) => one.status === EServiceStatus.Running)).toHaveLength(1)
    await registry.closeAll()
  })
})

const started = (name: string, id: string, bootId = 'b1'): Event =>
  ({ type: 'service-started', serviceId: id, name, command: 'c', bootId }) as unknown as Event
const ended = (id: string, killedBy: EKilledBy | undefined, bootId = 'b1'): Event =>
  ({
    type: 'service-ended',
    serviceId: id,
    command: 'c',
    bootId,
    status: EServiceStatus.Killed,
    killedBy,
    tail: '',
  }) as unknown as Event

describe('declaredServicesToResume', () => {
  it('resumes services the session ended or lost, not ones deliberately stopped', () => {
    const events = [
      started('web', 'svc_1'),
      ended('svc_1', EKilledBy.IdlePark),
      started('worker', 'svc_2'),
      started('db', 'svc_3'),
      ended('svc_3', EKilledBy.Model),
      started('cache', 'svc_4'),
      started('anon', 'svc_5'),
    ].map((event, index) => ({ ...event, seq: index }) as Event)
    events[6] = { ...events[6], name: undefined } as unknown as Event

    expect(declaredServicesToResume({ events })).toEqual(['web', 'worker', 'cache'])
  })

  it('takes the latest lifecycle per name', () => {
    const events = [
      started('web', 'svc_1'),
      ended('svc_1', EKilledBy.IdlePark),
      started('web', 'svc_1', 'b2'),
      ended('svc_1', EKilledBy.User, 'b2'),
    ] as unknown as Event[]

    expect(declaredServicesToResume({ events })).toEqual([])
  })
})

describe('resumeDeclaredServices', () => {
  it('re-ensures what the journal says was running', async () => {
    const { registry, processes } = open()
    const log = {
      readOwn: async () =>
        [started('worker', 'svc_1'), ended('svc_1', EKilledBy.IdlePark)] as unknown as Event[],
    }

    const result = await resumeDeclaredServices({ services: registry, log, threadId: THREAD })

    expect(result.map((one) => one.name)).toEqual(['worker'])
    expect(processes.servicesStarted()).toHaveLength(1)
    await registry.closeAll()
  })

  it('does nothing when nothing was running', async () => {
    const { registry, processes } = open()

    await resumeDeclaredServices({
      services: registry,
      log: { readOwn: async () => [] },
      threadId: THREAD,
    })

    expect(processes.servicesStarted()).toHaveLength(0)
  })
})
