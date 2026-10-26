import { EStatusTone, InlineSpinner, StatusDot } from './status-dot'
import { EPodState } from '../pod-status'

const DOT_TONE: Record<EPodState, EStatusTone> = {
  [EPodState.Starting]: EStatusTone.Pending,
  [EPodState.Running]: EStatusTone.Live,
  [EPodState.Resuming]: EStatusTone.Pending,
  [EPodState.Parked]: EStatusTone.Idle,
  [EPodState.Stopped]: EStatusTone.Idle,
}

export function ChipIcon({ state }: { state: EPodState }) {
  if (state === EPodState.Starting) return <InlineSpinner />
  return <StatusDot tone={DOT_TONE[state]} />
}
