import { describe, expect, it } from 'bun:test'
import { eventSchemaOf, eventTypesOf } from '@dltech/atlas-plugin-sdk'
import { composedPlugins, registeredPlugins } from './registered-plugins'

const serviceReady = {
  type: 'service-ready',
  serviceId: 'svc-abcd1234',
  id: 'e1',
  seq: 1,
  runId: 'run-1',
  depth: 0,
  epoch: 1,
  prevHash: '0'.repeat(64),
  threadId: 't1',
  at: '2026-11-08T10:00:00.000Z',
}

describe('registeredPlugins', () => {
  it('decodes a service-ready event through the composed schema', () => {
    const parsed = eventSchemaOf(registeredPlugins).safeParse(serviceReady)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ type: 'service-ready', serviceId: 'svc-abcd1234' })
  })

  it('rejects a service-ready event without an id', () => {
    expect(
      eventSchemaOf(registeredPlugins).safeParse({ ...serviceReady, serviceId: '' }).success,
    ).toBe(false)
  })

  it('contributes the services view', () => {
    expect(composedPlugins.views.map((view) => view.name)).toContain('services')
  })

  it('registers the sessions plugin', () => {
    expect(composedPlugins.names).toContain('sessions')
  })

  it('adds no event type', () => {
    const without = registeredPlugins.filter((plugin) => plugin.name !== 'sessions')
    expect(eventTypesOf(registeredPlugins)).toEqual(eventTypesOf(without))
  })
})
