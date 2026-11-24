import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { BrowserTool } from './browser-tool'
import { WebFetchTool } from './fetch-tool'
import { readerPortOf } from './read'
import { searchPortOf } from './search'
import { WebSearchTool } from './search-tool'

export { BrowserTool } from './browser-tool'
export { CACHE_TTL_MS, PageCache } from './cache'
export { htmlToMarkdown, htmlToText, titleOf } from './extract'
export { WebFetchTool } from './fetch-tool'
export {
  DEFAULT_TIMEOUT_SECONDS,
  EPageFormat,
  fetchPage,
  MAX_CHARACTERS,
  MAX_TIMEOUT_SECONDS,
} from './fetch-page'
export { pdfToText } from './pdf'
export type { ReadArgs, ReadOutcome, ReaderPort } from './read'
export { jinaReaderOf, readerPortOf } from './read'
export type { SearchOutcome, SearchPort, SearchRequest } from './search'
export { EFreshness, jinaSearchOf, searchPortOf } from './search'
export { WebSearchTool } from './search-tool'

export const WEB_TOOLS = ['web_search', 'web_fetch', 'browser'] as const

export type WebPodArgs = {
  jinaKey: string | undefined
  fetcher?: typeof fetch | undefined
}

export const webPodOf = (args: WebPodArgs): PodSlot => ({
  ...EMPTY_POD,
  tools: (ctx) => [
    new WebSearchTool(searchPortOf({ jinaKey: args.jinaKey, fetcher: args.fetcher })),
    new WebFetchTool({
      reader: readerPortOf({ jinaKey: args.jinaKey, fetcher: args.fetcher }),
    }),
    new BrowserTool(ctx),
  ],
})
