import { describe, expect, it } from 'bun:test'

import { EServiceStatus, type V2Event } from '@dltech/atlas-core'

import { foldServices, serviceReadySchema, servicesOfEvents, type ServicesViewState } from '..'

const at = (n: number): string => `2026-11-08T10:00:0${n}.000Z`

const stamp = (body: Record<string, unknown>, n: number): V2Event =>
  ({ ...body, seq: n, at: at(n), threadId: 't1', id: `e${n}` }) as unknown as V2Event

const started = (n: number, extra: Record<string, unknown> = {}): V2Event =>
  stamp({ type: 'service-started', serviceId: 'svc-a', command: 'bun dev', ...extra }, n)

const ready = (n: number, serviceId = 'svc-a'): V2Event =>
  stamp({ type: 'service-ready', serviceId }, n)

const ended = (n: number, status = EServiceStatus.Killed): V2Event =>
  stamp({ type: 'service-ended', serviceId: 'svc-a', command: 'bun dev', status, tail: '' }, n)

describe('services view', () => {
  it('shows a started service as running and not ready', () => {
    expect(servicesOfEvents([started(1, { description: 'web', port: 3000 })])).toEqual([
      {
        serviceId: 'svc-a',
        name: 'web',
        command: 'bun dev',
        port: 3000,
        status: EServiceStatus.Running,
        ready: false,
        changedAt: at(1),
      },
    ])
  })

  it('marks the row ready', () => {
    expect(servicesOfEvents([started(1), ready(2)])).toMatchObject([
      { serviceId: 'svc-a', status: EServiceStatus.Running, ready: true, changedAt: at(2) },
    ])
  })

  it('carries the public url a started service was published at', () => {
    expect(
      servicesOfEvents([started(1, { port: 3000, url: 'https://six-words.trycloudflare.com' })]),
    ).toMatchObject([{ url: 'https://six-words.trycloudflare.com' }])
    expect(servicesOfEvents([started(1, { port: 3000 })])).not.toMatchObject([
      { url: expect.anything() },
    ])
  })

  it('records the ending status and clears ready', () => {
    expect(servicesOfEvents([started(1), ready(2), ended(3)])).toMatchObject([
      { status: EServiceStatus.Killed, ready: false, command: 'bun dev', changedAt: at(3) },
    ])
  })

  it('adds a row for a ready that beat the start append', () => {
    expect(servicesOfEvents([ready(1, 'svc-z')])).toEqual([
      {
        serviceId: 'svc-z',
        command: '',
        status: EServiceStatus.Running,
        ready: true,
        changedAt: at(1),
      },
    ])
  })

  it('keeps other services untouched when one changes', () => {
    const rows = servicesOfEvents([
      started(1),
      stamp({ type: 'service-started', serviceId: 'svc-b', command: 'redis' }, 2),
      ready(3),
    ])
    expect(rows.map((row) => [row.serviceId, row.ready])).toEqual([
      ['svc-a', true],
      ['svc-b', false],
    ])
  })

  it('returns the same array for an unrelated event', () => {
    const state: ServicesViewState = servicesOfEvents([started(1)])
    expect(foldServices(state, stamp({ type: 'user-message', text: 'hi' }, 2))).toBe(state)
  })
})

describe('serviceReadySchema', () => {
  it('decodes a service-ready body and rejects an empty id', () => {
    expect(
      serviceReadySchema.safeParse({ type: 'service-ready', serviceId: 'svc-a' }).success,
    ).toBe(true)
    expect(serviceReadySchema.safeParse({ type: 'service-ready', serviceId: '' }).success).toBe(
      false,
    )
  })
})
