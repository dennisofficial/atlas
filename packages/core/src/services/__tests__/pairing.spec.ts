import { describe, expect, it } from 'bun:test'

import type { Event, EventEnvelope } from '../../events/envelope'
import { toEventId, toRunId, toThreadId } from '../../events/ids'
import { EServiceStatus } from '../status'
import {
  endedServiceKeysOf,
  lostServicesOf,
  serviceLifecycleKind,
  servicesLifecycle,
} from '../pairing'
import { ELifecycleState, type EventOfType } from '../../index'

const threadId = toThreadId('thread-services-lifecycle')

type StartedService = EventOfType<'service-started'>
type EndedService = EventOfType<'service-ended'>

let sequence = 0
const envelope = (): EventEnvelope => {
  sequence += 1
  return {
    id: toEventId(`event-${sequence}`),
    seq: sequence,
    threadId,
    runId: toRunId('run-1'),
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
  }
}

const started = (args: { serviceId: string; command?: string; bootId?: string }): StartedService =>
  ({
    type: 'service-started',
    serviceId: args.serviceId,
    command: args.command ?? 'bun run dev',
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
    ...envelope(),
  }) as StartedService

const ended = (args: { serviceId: string; command?: string; bootId?: string }): EndedService =>
  ({
    type: 'service-ended',
    serviceId: args.serviceId,
    command: args.command ?? 'bun run dev',
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
    status: EServiceStatus.Exited,
    exitCode: 0,
    logPath: '/tmp/svc.log',
    tail: '',
    ...envelope(),
  }) as EndedService

describe('servicesLifecycle', () => {
  it('marks a started-and-ended service settled', () => {
    const lifecycles = servicesLifecycle([
      started({ serviceId: 'svc_1', bootId: 'b1' }),
      ended({ serviceId: 'svc_1', bootId: 'b1' }),
    ])
    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
    expect(lifecycles[0]?.ending?.type).toBe('service-ended')
  })

  it('marks a start with no end lost', () => {
    const lifecycles = servicesLifecycle([started({ serviceId: 'svc_1', bootId: 'b1' })])
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
  })

  it('never lets a recycled svc id under a new boot settle a previous boot’s open start', () => {
    const lifecycles = servicesLifecycle([
      started({ serviceId: 'svc_1', bootId: 'b1', command: 'first boot' }),
      started({ serviceId: 'svc_1', bootId: 'b2', command: 'second boot' }),
      ended({ serviceId: 'svc_1', bootId: 'b2', command: 'second boot' }),
    ])
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
    expect(lifecycles[0]?.started.command).toBe('first boot')
    expect(lifecycles[1]?.state).toBe(ELifecycleState.Settled)
    expect(lifecycles[1]?.started.command).toBe('second boot')
  })

  it('pairs FIFO within one boot when an id is reused', () => {
    const lifecycles = servicesLifecycle([
      started({ serviceId: 'svc_1', bootId: 'b1', command: 'first' }),
      started({ serviceId: 'svc_1', bootId: 'b1', command: 'second' }),
      ended({ serviceId: 'svc_1', bootId: 'b1' }),
    ])
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
    expect(lifecycles[0]?.started.command).toBe('first')
    expect(lifecycles[1]?.state).toBe(ELifecycleState.Lost)
    expect(lifecycles[1]?.started.command).toBe('second')
  })

  it('pairs events that predate bootId on the shared empty scope', () => {
    const lifecycles = servicesLifecycle([
      started({ serviceId: 'svc_1' }),
      ended({ serviceId: 'svc_1' }),
    ])
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Settled)
  })

  it('ignores an end with no matching start', () => {
    expect(servicesLifecycle([ended({ serviceId: 'svc_9', bootId: 'b1' })])).toHaveLength(0)
  })

  it('skips unrelated events', () => {
    const lifecycles = servicesLifecycle([
      {
        type: 'background-shell-started',
        shellId: 'bash_1',
        command: 'bun test',
        ...envelope(),
      },
      started({ serviceId: 'svc_1', bootId: 'b1' }),
    ])
    expect(lifecycles).toHaveLength(1)
    expect(lifecycles[0]?.state).toBe(ELifecycleState.Lost)
  })
})

describe('lostServicesOf', () => {
  it('returns only the unsettled starts', () => {
    const events: Event[] = [
      started({ serviceId: 'svc_1', bootId: 'b1' }),
      started({ serviceId: 'svc_2', bootId: 'b1' }),
      ended({ serviceId: 'svc_1', bootId: 'b1' }),
    ]
    expect(lostServicesOf(events).map((lifecycle) => lifecycle.key)).toEqual(['svc_2'])
  })
})

describe('endedServiceKeysOf', () => {
  it('names the scoped key of every recorded end, including an orphan end', () => {
    const events: Event[] = [
      started({ serviceId: 'svc_1', bootId: 'b1' }),
      ended({ serviceId: 'svc_1', bootId: 'b1' }),
      ended({ serviceId: 'svc_1', bootId: 'b2' }),
    ]
    expect([...endedServiceKeysOf(events)].sort()).toEqual(['b1svc_1', 'b2svc_1'])
  })
})

describe('serviceLifecycleKind', () => {
  it('scopes to the empty string when an event carries no bootId', () => {
    expect(serviceLifecycleKind.scopeOf(started({ serviceId: 'svc_1' }))).toBe('')
  })
})
