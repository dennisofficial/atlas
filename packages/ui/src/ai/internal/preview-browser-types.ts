import type { EPreviewStatus } from '../preview-ports'

export enum EStageFit {
  Scale = 'scale',
  Scroll = 'scroll',
}

export interface PreviewBrowserTab {
  id: string
  title: string
  url: string
  status?: EPreviewStatus
}
