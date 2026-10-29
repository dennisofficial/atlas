import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'
import { EServiceStatus, type RosterWire, type ServiceSnapshotWire } from '@dltech/atlas-wire/web'

const MAX_LABEL = 28

type Candidate = { port: PreviewPort; startedAt: string }

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
      id: `service:${service.serviceId}`,
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
