import { refKey, supportedEfforts, type ModelCard } from '@dltech/atlas-core'
import { generatedCards } from '@dltech/atlas-models'
import { EModelProviderStatus, type ModelEntry, type ModelsResponse } from '@dltech/atlas-wire/web'
import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { EEffort, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

export const AUTO_MODEL_ID = 'auto'

export type AccountSummary = { provider: string; status: string }

export type ModelOptions = { models: ModelOption[]; reconnectProviders: string[] }

const EXPIRED = 'expired'
const MILLION = 1_000_000
const CHEAP_INPUT_PER_MILLION = 1
const PRICEY_INPUT_PER_MILLION = 5

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  inference: 'Inference.net',
}

const PROVIDER_BRANDS: Record<string, EBrand> = {
  anthropic: EBrand.Anthropic,
  openai: EBrand.OpenAI,
  openrouter: EBrand.OpenRouter,
}

const AUTO_OPTION: ModelOption = {
  id: AUTO_MODEL_ID,
  label: 'Atlas picks',
  auto: true,
  efforts: [],
}

const efforts = new Map<string, EEffort>(Object.values(EEffort).map((effort) => [effort, effort]))

export const providerNameOf = (providerId: string): string =>
  PROVIDER_NAMES[providerId] ?? providerId

export function contextLabelOf(tokens: number): string {
  if (tokens >= MILLION) return `${Math.round(tokens / 100_000) / 10}M`
  return `${Math.round(tokens / 1000)}k`
}

function rateForInput(inputPerMillion: number | undefined): string | undefined {
  if (inputPerMillion === undefined) return undefined
  if (inputPerMillion < CHEAP_INPUT_PER_MILLION) return '$'
  return inputPerMillion < PRICEY_INPUT_PER_MILLION ? '$$' : '$$$'
}

const rateOf = (card: ModelCard): string | undefined => rateForInput(card.cost?.inputPerMillion)

export function effortsOf(card: ModelCard): EEffort[] {
  return supportedEfforts(card.effort).flatMap((effort) => {
    const mapped = efforts.get(effort)
    return mapped === undefined ? [] : [mapped]
  })
}

function optionOf(card: ModelCard): ModelOption {
  const brand = PROVIDER_BRANDS[card.ref.providerId]
  const rate = rateOf(card)
  return {
    id: refKey(card.ref),
    label: card.label,
    provider: providerNameOf(card.ref.providerId),
    context: contextLabelOf(card.contextWindow),
    contextTokens: card.contextWindow,
    efforts: effortsOf(card),
    monogram: providerNameOf(card.ref.providerId).slice(0, 1),
    ...(brand === undefined ? {} : { brand }),
    ...(rate === undefined ? {} : { rate }),
  }
}

function withCurrent(args: {
  offered: ModelOption[]
  cards: readonly ModelCard[]
  currentId: string | undefined
}): ModelOption[] {
  const { offered, currentId } = args
  if (currentId === undefined || offered.some((option) => option.id === currentId)) return offered
  const card = args.cards.find((candidate) => refKey(candidate.ref) === currentId)
  const option: ModelOption =
    card === undefined ? { id: currentId, label: currentId } : optionOf(card)
  return [...offered, option]
}

export function modelOptionsOf(args: {
  accounts: readonly AccountSummary[]
  includeAuto?: boolean
  currentId?: string | undefined
}): ModelOptions {
  const usable = new Set<string>()
  const expired = new Set<string>()
  for (const account of args.accounts) {
    ;(account.status === EXPIRED ? expired : usable).add(account.provider)
  }
  const cards = generatedCards()
  const catalogueOrder = [...new Set(cards.map((card) => card.ref.providerId))]
  const offered = cards.filter((card) => usable.has(card.ref.providerId)).map(optionOf)
  const models = withCurrent({ offered, cards, currentId: args.currentId })
  const reconnectProviders = catalogueOrder
    .filter((providerId) => expired.has(providerId) && !usable.has(providerId))
    .map(providerNameOf)
  const withAuto = args.includeAuto !== false && models.length > 0
  return { models: withAuto ? [AUTO_OPTION, ...models] : models, reconnectProviders }
}

export type ModelsSource =
  | { kind: 'live'; response: ModelsResponse }
  | { kind: 'accounts'; accounts: readonly AccountSummary[] }

const effortsFromNames = (names: readonly string[]): EEffort[] =>
  names.flatMap((name) => {
    const mapped = efforts.get(name)
    return mapped === undefined ? [] : [mapped]
  })

function optionOfEntry(args: { providerId: string; entry: ModelEntry }): ModelOption {
  const { providerId, entry } = args
  const brand = PROVIDER_BRANDS[providerId]
  const rate = rateForInput(entry.inputPerMillion)
  return {
    id: entry.id,
    label: entry.label,
    provider: providerNameOf(providerId),
    context: contextLabelOf(entry.contextWindow),
    contextTokens: entry.contextWindow,
    efforts: effortsFromNames(entry.efforts),
    monogram: providerNameOf(providerId).slice(0, 1),
    ...(brand === undefined ? {} : { brand }),
    ...(rate === undefined ? {} : { rate }),
  }
}

export function modelOptionsFromResponse(args: {
  response: ModelsResponse
  includeAuto?: boolean
  currentId?: string | undefined
}): ModelOptions {
  const offered = args.response.providers
    .filter((provider) => provider.status === EModelProviderStatus.Connected)
    .flatMap((provider) =>
      provider.models.map((entry) => optionOfEntry({ providerId: provider.id, entry })),
    )
  const currentId = args.currentId
  const models =
    currentId === undefined || offered.some((option) => option.id === currentId)
      ? offered
      : [...offered, { id: currentId, label: currentId }]
  const reconnectProviders = args.response.providers
    .filter((provider) => provider.status === EModelProviderStatus.Expired)
    .map((provider) => providerNameOf(provider.id))
  const withAuto = args.includeAuto !== false && models.length > 0
  return { models: withAuto ? [AUTO_OPTION, ...models] : models, reconnectProviders }
}

export function modelOptionsOfSource(args: {
  source: ModelsSource | undefined
  includeAuto?: boolean
  currentId?: string | undefined
}): ModelOptions {
  const { source, ...rest } = args
  if (source === undefined) return { models: [], reconnectProviders: [] }
  if (source.kind === 'live')
    return modelOptionsFromResponse({ response: source.response, ...rest })
  return modelOptionsOf({ accounts: source.accounts, ...rest })
}
