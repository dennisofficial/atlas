import { describe, expect, test } from 'bun:test'

import { EServiceStatus } from '@dltech/atlas-core'
import type { ServiceRow as ServiceViewRow } from '@dltech/atlas-plugin-services/core'

import { drawerServicesOf, serviceFoldOf, serviceRowsOf } from '../drawer-services'

const rowOf = (patch: Partial<ServiceViewRow>): ServiceViewRow => ({
  serviceId: 'svc-1',
  command: 'bun dev',
  status: EServiceStatus.Running,
  ready: true,
  changedAt: '2026-11-20T00:00:00.000Z',
  ...patch,
})

describe('drawerServicesOf', () => {
  test('a declared port and url become the exposure the drawer reads', () => {
    const [service] = drawerServicesOf([rowOf({ port: 3000, url: 'https://preview.example.test' })])

    expect(service?.exposure).toEqual({
      containerPort: 3000,
      hostPort: 3000,
      url: 'https://preview.example.test',
    })
  })

  test('a row with no name falls back to its command', () => {
    const [service] = drawerServicesOf([rowOf({})])

    expect(service?.description).toBe('bun dev')
    expect(service?.name).toBeUndefined()
  })
})

describe('serviceRowsOf', () => {
  test('every v2 row is a runtime row keyed by its service id', () => {
    const services = drawerServicesOf([rowOf({ name: 'web', port: 3000, url: 'https://x.test' })])
    const rows = serviceRowsOf({ services, previews: [] })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('svc-1')
    expect(rows[0]?.name).toBe('web')
    expect(rows[0]?.declared).toBeUndefined()
    expect(rows[0]?.snapshot?.logPath).toBe('')
  })

  test('a running row with a port shows its preview url', () => {
    const previews = [{ serviceId: 'svc-1', label: 'web', port: 3000, url: 'https://x.test' }]
    const rows = serviceRowsOf({
      services: drawerServicesOf([rowOf({ name: 'web', port: 3000, url: 'https://x.test' })]),
      previews,
    })

    expect(rows[0]?.snapshot?.exposure?.url).toBe('https://x.test')
  })

  test('an empty view builds no rows', () => {
    expect(serviceRowsOf({ services: [], previews: [] })).toEqual([])
  })
})

describe('serviceFoldOf', () => {
  test('hides the settled services and counts a failed one', () => {
    const services = drawerServicesOf([
      rowOf({ serviceId: 'running' }),
      rowOf({ serviceId: 'exited', status: EServiceStatus.Exited }),
      rowOf({ serviceId: 'killed', status: EServiceStatus.Killed }),
    ])

    expect(serviceFoldOf(services)).toEqual({ hidden: 2, hiddenFailed: true })
  })
})
