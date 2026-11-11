import {
  BACKEND_TRAITS,
  backendOf,
  ESettingId,
  EWebSearchBackend,
  type WebSearchFindings,
} from '@dltech/atlas-core'

import { bing } from './bing'
import type { SearchBackend, SearchOutcome } from './contract'
import { duckDuckGo } from './duckduckgo'
import { jina } from './jina'
import { brave, exa, searxng, tavily } from './keyed'

const BACKENDS: Record<EWebSearchBackend, SearchBackend> = {
  [EWebSearchBackend.Bing]: bing,
  [EWebSearchBackend.DuckDuckGo]: duckDuckGo,
  [EWebSearchBackend.Jina]: jina,
  [EWebSearchBackend.Tavily]: tavily,
  [EWebSearchBackend.Exa]: exa,
  [EWebSearchBackend.Brave]: brave,
  [EWebSearchBackend.SearXNG]: searxng,
}

export const keylessBackend = (backend: EWebSearchBackend): boolean =>
  BACKEND_TRAITS[backend].keyLabel === undefined

export const resolveBackend = (name: string | undefined): EWebSearchBackend | undefined =>
  name === undefined ? undefined : backendOf(name)

export type FindingsOutcome =
  | { ok: true; findings: WebSearchFindings }
  | { ok: false; reason: string }

export async function runSearch(args: {
  backend: EWebSearchBackend | undefined
  query: string
  count: number
  signal: AbortSignal
  credential: string | undefined
}): Promise<FindingsOutcome> {
  if (args.backend === undefined) {
    return { ok: false, reason: 'the search backend setting names no backend this session knows' }
  }
  if (args.credential === undefined && !keylessBackend(args.backend)) {
    return {
      ok: false,
      reason: `${BACKEND_TRAITS[args.backend].label} needs a key and none is set: choose it under the ${ESettingId.WebSearchBackend} setting and save the key as search.${args.backend}`,
    }
  }

  const outcome: SearchOutcome = await BACKENDS[args.backend]({
    query: args.query,
    count: args.count,
    signal: args.signal,
    credential: args.credential,
  })

  if (!outcome.ok) return outcome
  return {
    ok: true,
    findings: { query: args.query, backend: args.backend, results: outcome.results },
  }
}
