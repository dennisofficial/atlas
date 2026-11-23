import { EWebSearchBackendWire as ESearchBackend } from '@dltech/atlas-wire/web'

export { ESearchBackend }

export type ChoiceItem<TValue extends string> = { value: TValue; label: string }

export const SEARCH_BACKEND_ITEMS: ChoiceItem<ESearchBackend>[] = [
  { value: ESearchBackend.Bing, label: 'Bing' },
  { value: ESearchBackend.DuckDuckGo, label: 'DuckDuckGo' },
  { value: ESearchBackend.Jina, label: 'Jina' },
  { value: ESearchBackend.Tavily, label: 'Tavily' },
  { value: ESearchBackend.Exa, label: 'Exa' },
  { value: ESearchBackend.Brave, label: 'Brave' },
  { value: ESearchBackend.SearXNG, label: 'SearXNG' },
]
