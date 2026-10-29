import { EDecisionsProvider, ESearchBackend } from '../../fixtures/settings-decisions'

export enum EKeyNoun {
  Key = 'key',
  Url = 'URL',
}

export type KeyTarget = {
  name: string
  label: string
  description: string
  noun: EKeyNoun
  masked: boolean
}

const DECISIONS_TOKEN_PREFIX = 'decisions.token.'
const SEARCH_SECRET_PREFIX = 'search.'

const SEARCH_BACKEND_LABELS: Record<ESearchBackend, string> = {
  [ESearchBackend.DuckDuckGo]: 'DuckDuckGo',
  [ESearchBackend.Jina]: 'Jina',
  [ESearchBackend.Tavily]: 'Tavily',
  [ESearchBackend.Exa]: 'Exa',
  [ESearchBackend.Brave]: 'Brave',
  [ESearchBackend.SearXNG]: 'SearXNG',
}

const API_KEY_DESCRIPTION =
  'Sent with every search to the selected backend. Saved encrypted to your account and never shown again.'

const SEARCH_KEY_SHAPES: Partial<Record<ESearchBackend, Omit<KeyTarget, 'name' | 'label'>>> = {
  [ESearchBackend.Jina]: {
    description:
      'Raises Jina from 20 to 500 searches a minute. Saved encrypted to your account and never shown again.',
    noun: EKeyNoun.Key,
    masked: true,
  },
  [ESearchBackend.Tavily]: { description: API_KEY_DESCRIPTION, noun: EKeyNoun.Key, masked: true },
  [ESearchBackend.Exa]: { description: API_KEY_DESCRIPTION, noun: EKeyNoun.Key, masked: true },
  [ESearchBackend.Brave]: { description: API_KEY_DESCRIPTION, noun: EKeyNoun.Key, masked: true },
  [ESearchBackend.SearXNG]: {
    description: 'The address of your own SearXNG instance, with its JSON output turned on.',
    noun: EKeyNoun.Url,
    masked: false,
  },
}

export function decisionsKeyTarget(provider: EDecisionsProvider): KeyTarget {
  return {
    name: `${DECISIONS_TOKEN_PREFIX}${provider}`,
    label: 'Decision key',
    description:
      'The bearer key the selected provider expects. Each provider keeps its own key, saved encrypted and never shown again.',
    noun: EKeyNoun.Key,
    masked: true,
  }
}

export function searchKeyTarget(backend: ESearchBackend): KeyTarget | null {
  const shape = SEARCH_KEY_SHAPES[backend]
  if (shape === undefined) return null
  const noun = shape.noun === EKeyNoun.Url ? 'instance URL' : 'API key'
  return {
    ...shape,
    name: `${SEARCH_SECRET_PREFIX}${backend}`,
    label: `${SEARCH_BACKEND_LABELS[backend]} ${noun}`,
  }
}
