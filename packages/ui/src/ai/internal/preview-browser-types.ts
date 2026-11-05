import type { EPreviewStatus } from '../preview-ports'

export interface PreviewBrowserTab {
  id: string
  title: string
  url: string
  status?: EPreviewStatus
}
