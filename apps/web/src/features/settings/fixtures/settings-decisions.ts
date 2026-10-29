import {
  DEFAULT_DECISIONS_MODEL_WIRE,
  EClassifierModeWire as EClassifierMode,
  EDecisionsProviderWire as EDecisionsProvider,
  EWebSearchBackendWire as ESearchBackend,
} from '@dltech/atlas-wire/web'

export { EClassifierMode, EDecisionsProvider, ESearchBackend }

export const DEFAULT_DECISIONS_MODEL = DEFAULT_DECISIONS_MODEL_WIRE

export type AgentSettings = {
  provider: EDecisionsProvider
  url: string
  model: string
  classifierMode: EClassifierMode
  searchBackend: ESearchBackend
}

export type ChoiceItem<TValue extends string> = { value: TValue; label: string }

export const DECISIONS_PROVIDER_ITEMS: ChoiceItem<EDecisionsProvider>[] = [
  { value: EDecisionsProvider.Typesafe, label: 'Typesafe AI' },
  { value: EDecisionsProvider.Vercel, label: 'Vercel AI Gateway' },
  { value: EDecisionsProvider.OpenAi, label: 'OpenAI' },
  { value: EDecisionsProvider.Custom, label: 'Custom endpoint' },
]

export const CLASSIFIER_MODE_ITEMS: ChoiceItem<EClassifierMode>[] = [
  { value: EClassifierMode.Off, label: 'Off' },
  { value: EClassifierMode.Shadow, label: 'Shadow' },
  { value: EClassifierMode.Nudge, label: 'Nudge' },
]

export const SEARCH_BACKEND_ITEMS: ChoiceItem<ESearchBackend>[] = [
  { value: ESearchBackend.DuckDuckGo, label: 'DuckDuckGo' },
  { value: ESearchBackend.Jina, label: 'Jina' },
  { value: ESearchBackend.Tavily, label: 'Tavily' },
  { value: ESearchBackend.Exa, label: 'Exa' },
  { value: ESearchBackend.Brave, label: 'Brave' },
  { value: ESearchBackend.SearXNG, label: 'SearXNG' },
]
