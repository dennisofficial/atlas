import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { previewPortForUrl } from '../preview-ports'
import { NEW_TAB_URL } from './browser-model'
import { parseWebUrl } from './web-url'

const NEW_TAB_TITLE = 'New tab'

export function titleOf(args: { url: string; ports: PreviewPort[] }): string {
  const { url, ports } = args
  if (url === NEW_TAB_URL) return NEW_TAB_TITLE
  const parsed = parseWebUrl(url)
  if (parsed === null) return url
  const port = previewPortForUrl({ url, ports })
  if (port === null) return parsed.host
  return parsed.pathname === '/' ? port.label : `${port.label}${parsed.pathname}`
}
