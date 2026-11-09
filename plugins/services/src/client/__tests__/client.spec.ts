import { describe, expect, it } from 'bun:test'

import { previewsOfView, servicesClient, servicesOfView } from '..'

const row = (overrides: Record<string, unknown> = {}) => ({
  serviceId: 'svc1',
  name: 'web',
  command: 'bun run dev',
  port: 4321,
  url: 'https://4321-abc.byatlas.dev',
  status: 'running',
  ready: true,
  changedAt: '2026-11-09T10:00:00.000Z',
  ...overrides,
})

const previewsOf = (rows: readonly unknown[]) => previewsOfView({ services: rows })

describe('servicesClient', () => {
  it('applies its roster hook to service events only', () => {
    const [hook] = servicesClient.hooks
    expect(hook?.name).toBe('services-roster')
    expect(hook?.appliesTo({ type: 'service-started' } as never)).toBe(true)
    expect(hook?.appliesTo({ type: 'background-shell-started' } as never)).toBe(false)
  })
})

describe('servicesOfView', () => {
  it('is empty when the view has no services entry', () => {
    expect(servicesOfView({})).toEqual([])
  })

  it('throws on a bag its schema refuses', () => {
    expect(() => servicesOfView({ services: [{ port: 'not a port' }] })).toThrow()
  })
})

describe('previewsOfView', () => {
  it('is empty without services', () => {
    expect(previewsOfView({})).toEqual([])
  })

  it('lists a running published service with its port and url', () => {
    expect(previewsOf([row()])).toEqual([
      { serviceId: 'svc1', label: 'web', port: 4321, url: 'https://4321-abc.byatlas.dev' },
    ])
  })

  it('leaves out a service that is not running, even though its url survives', () => {
    expect(previewsOf([row({ status: 'killed' })])).toEqual([])
  })

  it('leaves out a service kept inside the sandbox', () => {
    expect(previewsOf([row({ url: undefined })])).toEqual([])
  })

  it('leaves out a published row with no port to label it by', () => {
    expect(previewsOf([row({ port: undefined })])).toEqual([])
  })

  it('orders by port', () => {
    const rows = [row({ serviceId: 'b', port: 5000 }), row({ serviceId: 'a', port: 4000 })]
    expect(previewsOf(rows).map((item) => item.port)).toEqual([4000, 5000])
  })

  it('keeps the newest service when a restart shares a port', () => {
    const rows = [
      row({ serviceId: 'old', changedAt: '2026-11-09T10:00:00.000Z' }),
      row({ serviceId: 'new', changedAt: '2026-11-09T11:00:00.000Z' }),
    ]
    expect(previewsOf(rows)).toEqual([
      { serviceId: 'new', label: 'web', port: 4321, url: 'https://4321-abc.byatlas.dev' },
    ])
  })

  it('falls back to the command for a label and truncates it', () => {
    const [item] = previewsOf([
      row({ name: undefined, command: 'bun run a-very-long-command-that-keeps-going --flag' }),
    ])
    expect(item?.label).toBe('bun run a-very-long-command…')
  })
})
