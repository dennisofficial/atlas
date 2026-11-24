import { jinaReaderOf } from './jina-reader'

export type { ReadArgs, ReadOutcome, ReaderPort } from './contract'
export { jinaReaderOf } from './jina-reader'

export const readerPortOf = (args: {
  jinaKey: string | undefined
  fetcher?: typeof fetch | undefined
}): ReturnType<typeof jinaReaderOf> => jinaReaderOf({ key: args.jinaKey, fetcher: args.fetcher })
