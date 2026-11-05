import { EPreviewStatus } from '../preview-ports'
import { EStatusTone, StatusDot } from './status-dot'

const STATUS_TONE: Record<EPreviewStatus, EStatusTone> = {
  [EPreviewStatus.Live]: EStatusTone.Live,
  [EPreviewStatus.Starting]: EStatusTone.Pending,
  [EPreviewStatus.Stopped]: EStatusTone.Idle,
}

export function PreviewStatusDot({ status }: { status: EPreviewStatus }) {
  return <StatusDot tone={STATUS_TONE[status]} />
}
