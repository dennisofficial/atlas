import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'
import { EPreviewStatus } from '@dltech/atlas-ui/ai/preview-browser'

import { NEW_TAB_URL } from '../../data/preview-browser/browser-model'
import { previewPortForUrl } from '../../data/preview-ports'

export enum ETabPage {
  NewTab = 'new-tab',
  Loading = 'loading',
  External = 'external',
  Offline = 'offline',
  Frame = 'frame',
}

export type TabPage =
  | { kind: ETabPage.NewTab | ETabPage.Loading | ETabPage.External }
  | { kind: ETabPage.Offline | ETabPage.Frame; port: PreviewPort }

export function tabPageOf(args: { url: string; ports: PreviewPort[]; loaded: boolean }): TabPage {
  const { url, ports, loaded } = args
  if (url === NEW_TAB_URL) return { kind: ETabPage.NewTab }
  if (!loaded) return { kind: ETabPage.Loading }
  const port = previewPortForUrl({ url, ports })
  if (port === null) return { kind: ETabPage.External }
  if (port.status !== EPreviewStatus.Live) return { kind: ETabPage.Offline, port }
  return { kind: ETabPage.Frame, port }
}
