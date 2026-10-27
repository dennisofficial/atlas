export enum EPreviewStatus {
  Live = 'live',
  Starting = 'starting',
  Stopped = 'stopped',
}

export interface PreviewPort {
  id: string
  port: number
  label: string
  url: string
  frameSrc?: string
  status: EPreviewStatus
}

export const PREVIEW_STATUS_LABEL: Record<EPreviewStatus, string> = {
  [EPreviewStatus.Live]: 'Live',
  [EPreviewStatus.Starting]: 'Starting',
  [EPreviewStatus.Stopped]: 'Stopped',
}

export function selectedPortOf({
  ports,
  selectedId,
}: {
  ports: PreviewPort[]
  selectedId?: string
}): PreviewPort | undefined {
  return ports.find((port) => port.id === selectedId) ?? ports[0]
}
