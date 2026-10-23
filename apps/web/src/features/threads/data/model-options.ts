import { refKey, supportedEfforts, type ModelCard } from '@dltech/atlas-core'
import { generatedCards } from '@dltech/atlas-models'
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

function rateOf(card: ModelCard): string | undefined {
  if (card.cost === undefined) return undefined
  if (card.cost.inputPerMillion < CHEAP_INPUT_PER_MILLION) return '$'
  return card.cost.inputPerMillion < PRICEY_INPUT_PER_MILLION ? '$$' : '$$$'
}

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
