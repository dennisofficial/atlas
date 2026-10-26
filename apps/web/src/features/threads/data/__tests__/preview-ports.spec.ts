import { describe, expect, test } from 'bun:test'

import { EPreviewStatus } from '@dltech/atlas-ui/ai/preview-frame'
import {
  EServiceStatus,
  EShellStatus,
  type RosterWire,
  type ServiceSnapshotWire,
  type ShellSnapshotWire,
} from '@dltech/atlas-wire/web'

import { previewPortsOf } from '../preview-ports'

const exposure = (port: number) => ({
  containerPort: port,
  hostPort: port + 1000,
  url: `https://${port}.example.dev`,
})

const shell = (overrides: Partial<ShellSnapshotWire>): ShellSnapshotWire =>
  ({
    shellId: 'sh_1',
    threadId: 'thr_1',
    command: 'bun run dev',
    description: 'Dev server',
    status: EShellStatus.Running,
    startedAt: '2026-10-26T10:00:00Z',
    lastOutputAt: '2026-10-26T10:00:00Z',
    totalCharacters: 0,
    awaitingInput: false,
    ...overrides,
  }) as ShellSnapshotWire

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
    expect(previewPortsOf(roster({ shells: [shell({})], services: [service({})] }))).toEqual([])
  })

  test('lists exposed shells and services by port with running as live', () => {
    const ports = previewPortsOf(
      roster({
        shells: [shell({ exposure: exposure(5173) })],
        services: [service({ exposure: exposure(3000), status: EServiceStatus.Exited })],
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
        shells: [
          shell({
            description: ' ',
            command: 'x'.repeat(60),
            exposure: exposure(8080),
          }),
        ],
      }),
    )
    expect(port?.label).toHaveLength(28)
    expect(port?.label.endsWith('…')).toBe(true)
  })

  test('one entry per port: a live process beats a stopped one, then the newest wins', () => {
    const ports = previewPortsOf(
      roster({
        shells: [
          shell({
            shellId: 'old',
            description: 'Old',
            exposure: exposure(3000),
            status: EShellStatus.Killed,
          }),
          shell({
            shellId: 'a',
            description: 'A',
            exposure: exposure(4000),
            startedAt: '2026-10-26T09:00:00Z',
          }),
          shell({
            shellId: 'b',
            description: 'B',
            exposure: exposure(4000),
            startedAt: '2026-10-26T11:00:00Z',
          }),
        ],
        services: [service({ exposure: exposure(3000) })],
      }),
    )
    expect(ports.map((port) => [port.port, port.id, port.status])).toEqual([
      [3000, 'service:svc_1', EPreviewStatus.Live],
      [4000, 'shell:b', EPreviewStatus.Live],
    ])
  })
})
