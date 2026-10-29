export enum EDecisionsProvider {
  Typesafe = 'typesafe',
  Vercel = 'vercel',
  OpenAi = 'openai',
  Custom = 'custom',
}

export enum EClassifierChoice {
  Default = 'default',
  Off = 'off',
  Shadow = 'shadow',
  Nudge = 'nudge',
}

export enum ESearchBackend {
  DuckDuckGo = 'duckduckgo',
  Jina = 'jina',
  Tavily = 'tavily',
  Exa = 'exa',
  Brave = 'brave',
  SearXNG = 'searxng',
}

export enum EKeyNoun {
  Key = 'key',
  Url = 'URL',
}

export const DEFAULT_DECISIONS_MODEL = 'jev-latest'

export type AgentSettings = {
  provider: EDecisionsProvider
  url: string
  model: string
  classifierMode: EClassifierChoice
  searchBackend: ESearchBackend
}

export type ChoiceItem<TValue extends string> = { value: TValue; label: string }

export type KeyTarget = {
  name: string
  label: string
  description: string
  noun: EKeyNoun
  masked: boolean
}

export const AGENT_DEFAULTS: AgentSettings = {
  provider: EDecisionsProvider.Typesafe,
  url: '',
  model: '',
  classifierMode: EClassifierChoice.Default,
  searchBackend: ESearchBackend.DuckDuckGo,
}

export const SAVED_KEY_NAMES: ReadonlySet<string> = new Set(['decisions.token.typesafe'])

export const DECISIONS_PROVIDER_ITEMS: ChoiceItem<EDecisionsProvider>[] = [
  { value: EDecisionsProvider.Typesafe, label: 'Typesafe AI' },
  { value: EDecisionsProvider.Vercel, label: 'Vercel AI Gateway' },
  { value: EDecisionsProvider.OpenAi, label: 'OpenAI' },
  { value: EDecisionsProvider.Custom, label: 'Custom endpoint' },
]

export const CLASSIFIER_MODE_ITEMS: ChoiceItem<EClassifierChoice>[] = [
  { value: EClassifierChoice.Default, label: 'Default' },
  { value: EClassifierChoice.Off, label: 'Off' },
  { value: EClassifierChoice.Shadow, label: 'Shadow' },
  { value: EClassifierChoice.Nudge, label: 'Nudge' },
]

export const SEARCH_BACKEND_ITEMS: ChoiceItem<ESearchBackend>[] = [
  { value: ESearchBackend.DuckDuckGo, label: 'DuckDuckGo' },
  { value: ESearchBackend.Jina, label: 'Jina' },
  { value: ESearchBackend.Tavily, label: 'Tavily' },
  { value: ESearchBackend.Exa, label: 'Exa' },
  { value: ESearchBackend.Brave, label: 'Brave' },
  { value: ESearchBackend.SearXNG, label: 'SearXNG' },
]

const API_KEY_DESCRIPTION =
  'Sent with every search to the selected backend. Saved encrypted to your account and never shown again.'

const SEARCH_KEY_TARGETS: Partial<Record<ESearchBackend, KeyTarget>> = {
  [ESearchBackend.Jina]: {
    name: 'search.jina',
    label: 'Jina API key',
    description:
      'Raises Jina from 20 to 500 searches a minute. Saved encrypted to your account and never shown again.',
    noun: EKeyNoun.Key,
    masked: true,
  },
  [ESearchBackend.Tavily]: {
    name: 'search.tavily',
    label: 'Tavily API key',
    description: API_KEY_DESCRIPTION,
    noun: EKeyNoun.Key,
    masked: true,
  },
  [ESearchBackend.Exa]: {
    name: 'search.exa',
    label: 'Exa API key',
    description: API_KEY_DESCRIPTION,
    noun: EKeyNoun.Key,
    masked: true,
  },
  [ESearchBackend.Brave]: {
    name: 'search.brave',
    label: 'Brave API key',
    description: API_KEY_DESCRIPTION,
    noun: EKeyNoun.Key,
    masked: true,
  },
  [ESearchBackend.SearXNG]: {
    name: 'search.searxng',
    label: 'SearXNG instance URL',
    description: 'The address of your own SearXNG instance, with its JSON output turned on.',
    noun: EKeyNoun.Url,
    masked: false,
  },
}

export function decisionsKeyTarget(provider: EDecisionsProvider): KeyTarget {
  return {
    name: `decisions.token.${provider}`,
    label: 'Decision key',
    description:
      'The bearer key the selected provider expects. Each provider keeps its own key, saved encrypted and never shown again.',
    noun: EKeyNoun.Key,
    masked: true,
  }
}

export function searchKeyTarget(backend: ESearchBackend): KeyTarget | null {
  return SEARCH_KEY_TARGETS[backend] ?? null
}

export function isValidDecisionsUrl(url: string): boolean {
  const trimmed = url.trim()
  if (trimmed === '') return true
  return /^https?:\/\/\S+$/.test(trimmed)
}
