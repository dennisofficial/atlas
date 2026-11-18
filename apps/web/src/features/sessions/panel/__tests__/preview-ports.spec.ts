import { describe, expect, it } from 'bun:test'

import type { PreviewItem } from '@dltech/atlas-plugin-services/client'
import { EPreviewStatus } from '@dltech/atlas-ui/ai/preview-browser'

import { previewPortOf, previewPortsOf } from '../preview-ports'

const item = (overrides: Partial<PreviewItem> = {}): PreviewItem => ({
  serviceId: 'svc-web',
  label: 'web',
  port: 4321,
  url: 'https://4321-abc.byatlas.dev',
  ...overrides,
})

describe('previewPortOf', () => {
  it('carries the service under a prefixed id, live and with its port', () => {
    expect(previewPortOf(item())).toEqual({
      id: 'service:svc-web',
      port: 4321,
      label: 'web',
      url: 'https://4321-abc.byatlas.dev',
      status: EPreviewStatus.Live,
    })
  })
})

describe('previewPortsOf', () => {
  it('keeps the order the view folded', () => {
    const ports = previewPortsOf([item({ serviceId: 'svc-a', label: 'api', port: 5000 }), item()])
    expect(ports.map((port) => port.port)).toEqual([5000, 4321])
    expect(ports.map((port) => port.id)).toEqual(['service:svc-a', 'service:svc-web'])
  })

  it('reads nothing from a session that exposes nothing', () => {
    expect(previewPortsOf([])).toEqual([])
  })
})
