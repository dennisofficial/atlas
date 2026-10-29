import { describe, expect, test } from 'bun:test'

import { EPreviewStatus } from '@dltech/atlas-ui/ai/preview-frame'
import { EServiceStatus, type RosterWire, type ServiceSnapshotWire } from '@dltech/atlas-wire/web'

import { livePreviewCount, previewPortsOf } from '../preview-ports'

const exposure = (port: number) => ({
  containerPort: port,
  hostPort: port + 1000,
  url: `https://${port}.example.dev`,
})

const service = (overrides: Partial<ServiceSnapshotWire>): ServiceSnapshotWire => ({
  serviceId: 'svc_1',
  command: 'bun run api',
  description: 'API',
  status: EServiceStatus.Running,
  logPath: '/tmp/api.log',
  startedAt: '2026-10-26T10:00:00Z',
  ...overrides,
})

const roster = (parts: Partial<RosterWire>): RosterWire => ({
  shells: [],
  agents: [],
  services: [],
  ...parts,
})

describe('previewPortsOf', () => {
  test('is empty without a roster or exposures', () => {
    expect(previewPortsOf(null)).toEqual([])
    expect(previewPortsOf(roster({ services: [service({})] }))).toEqual([])
  })

  test('lists exposed services by port with running as live', () => {
    const ports = previewPortsOf(
      roster({
        services: [
          service({ exposure: exposure(5173), description: 'Dev server' }),
          service({
            serviceId: 'svc_2',
            exposure: exposure(3000),
            status: EServiceStatus.Exited,
          }),
        ],
      }),
    )
    expect(ports.map((port) => [port.port, port.label, port.status, port.url])).toEqual([
      [3000, 'API', EPreviewStatus.Stopped, 'https://3000.example.dev'],
      [5173, 'Dev server', EPreviewStatus.Live, 'https://5173.example.dev'],
    ])
  })

  test('falls back to the command and truncates long labels', () => {
    const [port] = previewPortsOf(
      roster({
        services: [
          service({ description: ' ', command: 'x'.repeat(60), exposure: exposure(8080) }),
        ],
      }),
    )
    expect(port?.label).toHaveLength(28)
    expect(port?.label.endsWith('…')).toBe(true)
  })

  test('one entry per port: a live process beats a stopped one, then the newest wins', () => {
    const ports = previewPortsOf(
      roster({
        services: [
          service({ serviceId: 'old', exposure: exposure(3000), status: EServiceStatus.Killed }),
          service({ serviceId: 'live', exposure: exposure(3000) }),
          service({
            serviceId: 'a',
            exposure: exposure(4000),
            startedAt: '2026-10-26T09:00:00Z',
          }),
          service({
            serviceId: 'b',
            exposure: exposure(4000),
            startedAt: '2026-10-26T11:00:00Z',
          }),
        ],
      }),
    )
    expect(ports.map((port) => [port.port, port.id, port.status])).toEqual([
      [3000, 'service:live', EPreviewStatus.Live],
      [4000, 'service:b', EPreviewStatus.Live],
    ])
  })
})

describe('livePreviewCount', () => {
  test('counts only the ports still serving', () => {
    const ports = previewPortsOf(
      roster({
        shells: [shell({ exposure: exposure(5173) })],
        services: [
          service({ exposure: exposure(3000) }),
          service({ serviceId: 'svc_2', exposure: exposure(8080), status: EServiceStatus.Exited }),
        ],
      }),
    )
    expect(livePreviewCount(ports)).toBe(2)
    expect(livePreviewCount([])).toBe(0)
  })
})
