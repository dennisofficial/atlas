import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { BrowserTool } from './browser-tool'
import { WebFetchTool } from './fetch-tool'

export { BrowserTool } from './browser-tool'
export { CACHE_TTL_MS, PageCache } from './cache'
export { htmlToMarkdown, htmlToText, titleOf } from './extract'
export { WebFetchTool } from './fetch-tool'
export { DEFAULT_TIMEOUT_SECONDS, EPageFormat, fetchPage, MAX_TIMEOUT_SECONDS } from './fetch-page'
export { pdfToText } from './pdf'

export const WEB_TOOLS = ['web_fetch', 'browser'] as const

export const webPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => [new WebFetchTool(), new BrowserTool(ctx)],
}
