import { jinaSearchOf } from './jina'

export { EFreshness } from './contract'
export { jinaSearchOf } from './jina'
export type { SearchOutcome, SearchPort, SearchRequest } from './contract'

export const searchPortOf = (args: {
  jinaKey: string | undefined
  fetcher?: typeof fetch | undefined
}): ReturnType<typeof jinaSearchOf> => jinaSearchOf({ key: args.jinaKey, fetcher: args.fetcher })
