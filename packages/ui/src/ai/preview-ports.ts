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
