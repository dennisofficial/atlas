import { EDeclaredServiceState, EServiceStatus, type DeclaredServiceView } from '@dltech/atlas-core'
import type { ServiceSnapshot } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import {
  buildServiceRows,
  moveServiceSelection,
  rowActions,
  rowStateLabel,
  rowTone,
  EServiceTone,
  openServices,
  selectedService,
  selectService,
} from '../services-model'

const service = (over: { serviceId: string; status?: EServiceStatus }): ServiceSnapshot => ({
  serviceId: over.serviceId,
  command: 'bun run dev',
  description: 'bun run dev',
  status: over.status ?? EServiceStatus.Exited,
  pid: 4242,
  logPath: '/tmp/svc.log',
  startedAt: '2026-08-27T12:00:00.000Z',
  endedAt: '2026-08-27T12:01:00.000Z',
})

const rowsOf = (services: readonly ServiceSnapshot[]) =>
  buildServiceRows({ declared: null, services })

const view = (over: Partial<DeclaredServiceView> & { name: string }): DeclaredServiceView => ({
  state: EDeclaredServiceState.Stopped,
  links: [],
  ...over,
})

describe('openServices', () => {
  it('lands on the service it was asked for', () => {
    const services = [service({ serviceId: 'svc_1' }), service({ serviceId: 'svc_2' })]

    expect(openServices({ rows: rowsOf(services), key: 'svc_2' })).toEqual({ index: 1 })
  })

  it('prefers the running one when it was not asked for any', () => {
    const services = [
      service({ serviceId: 'svc_1' }),
      service({ serviceId: 'svc_2', status: EServiceStatus.Running }),
    ]

    expect(openServices({ rows: rowsOf(services) })).toEqual({ index: 1 })
  })

  it('falls back to the first when none is running', () => {
    const services = [service({ serviceId: 'svc_1' }), service({ serviceId: 'svc_2' })]

    expect(openServices({ rows: rowsOf(services) })).toEqual({ index: 0 })
  })
})

describe('moveServiceSelection', () => {
  it('clamps at both ends', () => {
    expect(moveServiceSelection({ state: { index: 0 }, count: 2, delta: -1 })).toEqual({ index: 0 })
    expect(moveServiceSelection({ state: { index: 1 }, count: 2, delta: 1 })).toEqual({ index: 1 })
    expect(moveServiceSelection({ state: { index: 0 }, count: 2, delta: 1 })).toEqual({ index: 1 })
  })
})

describe('selectService', () => {
  it('points at the named service and at the first for one it does not know', () => {
    const services = [service({ serviceId: 'svc_1' }), service({ serviceId: 'svc_2' })]

    expect(selectService({ rows: rowsOf(services), key: 'svc_2' })).toEqual({ index: 1 })
    expect(selectService({ rows: rowsOf(services), key: 'svc_9' })).toEqual({ index: 0 })
  })
})

describe('selectedService', () => {
  it('keeps pointing at a service when the roster shrinks under the index', () => {
    const services = [service({ serviceId: 'svc_1' })]

    expect(
      selectedService({ state: { index: 4 }, rows: rowsOf(services) })?.snapshot?.serviceId,
    ).toBe('svc_1')
    expect(selectedService({ state: { index: 0 }, rows: [] })).toBeUndefined()
  })
})

describe('declared rows', () => {
  it('lists declared services first, never-started ones included, then one-off services', () => {
    const rows = buildServiceRows({
      declared: {
        services: [view({ name: 'web' }), view({ name: 'api', serviceId: 'svc_1' })],
        rejections: [],
      },
      services: [
        { ...service({ serviceId: 'svc_1' }), name: 'api' },
        service({ serviceId: 'svc_2' }),
      ],
    })

    expect(rows.map((row) => row.name)).toEqual(['web', 'api', 'bun run dev'])
    expect(rows[0]?.snapshot).toBeUndefined()
    expect(rows[1]?.snapshot?.serviceId).toBe('svc_1')
  })

  it('opens on the first running declared entry and selects a never-started one by key', () => {
    const rows = buildServiceRows({
      declared: {
        services: [
          view({ name: 'web' }),
          view({ name: 'api', state: EDeclaredServiceState.Running }),
        ],
        rejections: [],
      },
      services: [],
    })

    expect(openServices({ rows })).toEqual({ index: 1 })
    expect(selectService({ rows, key: 'declared:web' })).toEqual({ index: 0 })
  })

  it('labels, tones and offers actions by declared state', () => {
    const [stopped, stale, failed] = buildServiceRows({
      declared: {
        services: [
          view({ name: 'a' }),
          view({ name: 'b', state: EDeclaredServiceState.Stale, serviceId: 'svc_1' }),
          view({ name: 'c', state: EDeclaredServiceState.Failed, serviceId: 'svc_2' }),
        ],
        rejections: [],
      },
      services: [],
    })

    expect(rowStateLabel({ row: stopped!, now: 0 })).toBe('not started')
    expect(rowActions(stopped!)).toEqual({ start: true, restart: false, stop: false })
    expect(rowTone(stale!)).toBe(EServiceTone.Attention)
    expect(rowActions(stale!)).toEqual({ start: true, restart: true, stop: true })
    expect(rowActions(failed!)).toEqual({ start: true, restart: true, stop: false })
  })
})
