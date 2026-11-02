import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'
import { EServiceStatus, type RosterWire, type ServiceSnapshotWire } from '@dltech/atlas-wire/web'

const MAX_LABEL = 28

type Candidate = { port: PreviewPort; startedAt: string }

export const previewIdOf = (serviceId: string): string => `service:${serviceId}`

const labelOf = (args: { description: string; command: string }): string => {
  const text = args.description.trim() || args.command.trim()
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text
}

const statusOf = (running: boolean): EPreviewStatus =>
  running ? EPreviewStatus.Live : EPreviewStatus.Stopped

function fromService(service: ServiceSnapshotWire): Candidate | null {
  const { exposure } = service
  if (exposure === undefined) return null
  return {
    startedAt: service.startedAt,
    port: {
      id: previewIdOf(service.serviceId),
      port: exposure.containerPort,
      label: labelOf(service),
      url: exposure.url,
      status: statusOf(service.status === EServiceStatus.Running),
    },
  }
}

const outranks = (args: { next: Candidate; current: Candidate }): boolean => {
  const { next, current } = args
  const nextLive = next.port.status === EPreviewStatus.Live
  const currentLive = current.port.status === EPreviewStatus.Live
  if (nextLive !== currentLive) return nextLive
  return next.startedAt > current.startedAt
}

export const livePreviewCount = (ports: PreviewPort[]): number =>
  ports.filter((port) => port.status === EPreviewStatus.Live).length

export function previewPortsOf(roster: RosterWire | null): PreviewPort[] {
  if (roster === null) return []
  const candidates = roster.services.map(fromService)
  const byPort = new Map<number, Candidate>()
  for (const candidate of candidates) {
    if (candidate === null) continue
    const current = byPort.get(candidate.port.port)
    if (current === undefined || outranks({ next: candidate, current })) {
      byPort.set(candidate.port.port, candidate)
    }
  }
  return [...byPort.values()].map(({ port }) => port).sort((left, right) => left.port - right.port)
}

const originOf = (value: string): string | null => {
  try {
    const { protocol, origin } = new URL(value)
    return protocol === 'http:' || protocol === 'https:' ? origin : null
  } catch {
    return null
  }
}

export function previewPortForUrl(args: { url: string; ports: PreviewPort[] }): PreviewPort | null {
  const origin = originOf(args.url)
  if (origin === null) return null
  return (
    args.ports.find(
      (port) => originOf(port.url) === origin || originOf(port.frameSrc ?? '') === origin,
    ) ?? null
  )
}

export type LinkClickModifiers = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export type PreviewLinkRoute = { portId: string; url: string }

export function previewLinkRouteOf(args: {
  href: string
  ports: PreviewPort[]
  click: LinkClickModifiers
}): PreviewLinkRoute | null {
  const { href, ports, click } = args
  if (click.button !== 0) return null
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
  const port = previewPortForUrl({ url: href, ports })
  return port === null ? null : { portId: port.id, url: href }
}
