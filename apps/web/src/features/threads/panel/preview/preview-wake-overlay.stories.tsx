import { EPreviewWait } from '../../data/preview-browser/preview-wake'
import { PreviewWakeOverlay } from './preview-wake-overlay'

const meta = {
  title: 'Sessions/Preview waking overlay',
  parameters: { layout: 'fullscreen' },
}

export default meta

const stage = (wait: EPreviewWait, loading: boolean) => (
  <div className="relative h-[30rem] w-full max-w-3xl overflow-hidden border-r bg-white">
    <PreviewWakeOverlay wait={wait} loading={loading} delayMs={0} />
  </div>
)

export const WakingPod = {
  render: () => stage(EPreviewWait.Asleep, true),
}

export const LoadingPreview = {
  render: () => stage(EPreviewWait.Awake, true),
}
