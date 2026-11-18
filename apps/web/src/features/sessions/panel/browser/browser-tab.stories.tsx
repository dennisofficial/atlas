import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { BrowserTab } from './browser-tab'

const LIVE_PORT: PreviewPort = {
  id: 'service:svc-web',
  port: 4321,
  label: 'web',
  url: 'http://localhost:4321',
  status: EPreviewStatus.Live,
}

const meta = {
  title: 'Sessions/Pane browser',
  parameters: { layout: 'fullscreen' },
}

export default meta

const tab = (ports: readonly PreviewPort[]) => (
  <div className="h-[36rem] w-full max-w-3xl border-r bg-card">
    <BrowserTab sessionId={`stories-${ports.length}`} ports={ports} loaded />
  </div>
)

export const NoPorts = {
  render: () => tab([]),
}

export const LiveService = {
  render: () => tab([LIVE_PORT]),
}
