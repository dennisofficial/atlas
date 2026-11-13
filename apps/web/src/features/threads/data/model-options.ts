import {
  ANTHROPIC_PROVIDER_ID,
  EImageTier,
  effortLabelsOf,
  outputPriceLabel,
  parseRef,
  refKey,
  supportedEfforts,
  type EEffort as EEffortRung,
  type ModelCard,
} from '@dltech/atlas-core'
import {
  catalogueProviders,
  CLAUDE_PLAN_LABEL,
  CODEX_PLAN_LABEL,
  GATEWAY_LABEL,
  GATEWAY_PROVIDER_ID,
  INFERENCE_LABEL,
  INFERENCE_PROVIDER_ID,
  OPENAI_PROVIDER_ID,
  OPENROUTER_LABEL,
  OPENROUTER_PROVIDER_ID,
} from '@dltech/atlas-harness/models'
import { withoutDatedDuplicates } from '@dltech/atlas-models'
import { EModelProviderStatus, type ModelEntry, type ModelsResponse } from '@dltech/atlas-wire/web'
import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { EEffort, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

export type AccountSummary = { provider: string; status: string }

export type ModelOptions = { models: ModelOption[]; reconnectProviders: string[] }

const EXPIRED = 'expired'
const MILLION = 1_000_000

const NO_KEY_NOTE = 'not connected'
const EXPIRED_NOTE = 'Sign-in expired'

const PROVIDER_NAMES: Record<string, string> = {
  [ANTHROPIC_PROVIDER_ID]: CLAUDE_PLAN_LABEL,
  [OPENAI_PROVIDER_ID]: CODEX_PLAN_LABEL,
  [OPENROUTER_PROVIDER_ID]: OPENROUTER_LABEL,
  [INFERENCE_PROVIDER_ID]: INFERENCE_LABEL,
  [GATEWAY_PROVIDER_ID]: GATEWAY_LABEL,
}

const PROVIDER_BRANDS: Record<string, EBrand> = {
  [ANTHROPIC_PROVIDER_ID]: EBrand.Anthropic,
  [OPENAI_PROVIDER_ID]: EBrand.OpenAI,
  [OPENROUTER_PROVIDER_ID]: EBrand.OpenRouter,
  [INFERENCE_PROVIDER_ID]: EBrand.Inference,
  [GATEWAY_PROVIDER_ID]: EBrand.Vercel,
}

const efforts = new Map<string, EEffort>(Object.values(EEffort).map((effort) => [effort, effort]))

export const providerNameOf = (providerId: string): string =>
  PROVIDER_NAMES[providerId] ?? providerId

const ANTHROPIC_LABEL_PREFIX = 'Claude '

export const modelLabelOf = ({ providerId, label }: { providerId: string; label: string }) =>
  providerId === ANTHROPIC_PROVIDER_ID && label.startsWith(ANTHROPIC_LABEL_PREFIX)
    ? label.slice(ANTHROPIC_LABEL_PREFIX.length)
    : label

export function contextLabelOf(tokens: number): string {
  if (tokens >= MILLION) return `${Math.round(tokens / 100_000) / 10}M`
  return `${Math.round(tokens / 1000)}k`
}

function rateOfEntry(entry: ModelEntry): string | undefined {
  if (entry.inputPerMillion === undefined || entry.outputPerMillion === undefined) return undefined
  return outputPriceLabel({
    inputPerMillion: entry.inputPerMillion,
    outputPerMillion: entry.outputPerMillion,
  })
}

export function effortsOf(card: ModelCard): EEffort[] {
  return supportedEfforts(card.effort).flatMap((effort) => {
    const mapped = efforts.get(effort)
    return mapped === undefined ? [] : [mapped]
  })
}

const imagesOf = (tier: string | undefined): { images?: boolean } =>
  tier === undefined ? {} : { images: tier === EImageTier.HighResolution }

const unavailableFields = (
  note: string | undefined,
): Pick<ModelOption, 'disabled' | 'disabledNote'> =>
  note === undefined ? {} : { disabled: true, disabledNote: note }

const effortsFromNames = (names: readonly string[]): EEffort[] =>
  names.flatMap((name) => {
    const mapped = efforts.get(name)
    return mapped === undefined ? [] : [mapped]
  })

const labelledEfforts = (
  labels: Partial<Record<EEffortRung, string>> | undefined,
): Pick<ModelOption, 'effortLabels'> => {
  const mapped: Partial<Record<EEffort, string>> = {}
  for (const [rung, label] of Object.entries(labels ?? {})) {
    const known = efforts.get(rung)
    if (known !== undefined && label !== undefined) mapped[known] = label
  }
  return Object.keys(mapped).length === 0 ? {} : { effortLabels: mapped }
}

function optionOf({ card, note }: { card: ModelCard; note?: string }): ModelOption {
  const brand = PROVIDER_BRANDS[card.ref.providerId]
  const rate = outputPriceLabel(card.cost)
  return {
    ...imagesOf(card.imageTier),
    ...unavailableFields(note),
    id: refKey(card.ref),
    label: modelLabelOf({ providerId: card.ref.providerId, label: card.label }),
    provider: providerNameOf(card.ref.providerId),
    context: contextLabelOf(card.contextWindow),
    contextTokens: card.contextWindow,
    efforts: effortsOf(card),
    ...labelledEfforts(effortLabelsOf(card.effort)),
    fast: card.fast === true,
    monogram: providerNameOf(card.ref.providerId).slice(0, 1),
    ...(brand === undefined ? {} : { brand }),
    ...(rate === undefined ? {} : { rate }),
  }
}

const notConnectedNote = (providerId: string): string =>
  `${providerNameOf(providerId)} ${NO_KEY_NOTE}`

const unknownOption = ({ id, note }: { id: string; note: string | undefined }): ModelOption => ({
  id,
  label: id,
  ...unavailableFields(note ?? EXPIRED_NOTE),
})

function withCurrent(args: {
  offered: ModelOption[]
  currentIds: readonly string[]
  optionFor: (id: string) => ModelOption
}): ModelOption[] {
  const extra = args.currentIds
    .filter((id) => id !== '' && !args.offered.some((option) => option.id === id))
    .map(args.optionFor)
  return [...args.offered, ...extra]
}

export function modelOptionsOf(args: {
  accounts: readonly AccountSummary[]
  currentIds?: readonly string[]
}): ModelOptions {
  const currentIds = args.currentIds ?? []
  const usable = new Set<string>()
  const expired = new Set<string>()
  for (const account of args.accounts) {
    ;(account.status === EXPIRED ? expired : usable).add(account.provider)
  }
  const providers = catalogueProviders().map((source) => ({
    id: source.id,
    cards: withoutDatedDuplicates(source.cards()),
  }))
  const cards = providers.flatMap((provider) => provider.cards)
  const cardById = new Map(cards.map((card) => [refKey(card.ref), card]))
  const reconnecting = providers.filter(
    (provider) => expired.has(provider.id) && !usable.has(provider.id),
  )
  const offered = providers
    .filter((provider) => !reconnecting.includes(provider))
    .flatMap((provider) =>
      provider.cards
        .filter((card) => usable.has(provider.id) || currentIds.includes(refKey(card.ref)))
        .map((card) =>
          optionOf({
            card,
            ...(usable.has(provider.id) ? {} : { note: notConnectedNote(provider.id) }),
          }),
        ),
    )
  const optionFor = (id: string): ModelOption => {
    const card = cardById.get(id)
    if (card === undefined) return unknownOption({ id, note: undefined })
    const providerId = card.ref.providerId
    const expiredHere = reconnecting.some((provider) => provider.id === providerId)
    return optionOf({ card, note: expiredHere ? EXPIRED_NOTE : notConnectedNote(providerId) })
  }
  return {
    models: withCurrent({ offered, currentIds, optionFor }),
    reconnectProviders: reconnecting.map((provider) => providerNameOf(provider.id)),
  }
}

export type ModelsSource =
  | { kind: 'live'; response: ModelsResponse }
  | { kind: 'accounts'; accounts: readonly AccountSummary[] }

function optionOfEntry(args: {
  providerId: string
  entry: ModelEntry
  note?: string
}): ModelOption {
  const { providerId, entry } = args
  const brand = PROVIDER_BRANDS[providerId]
  const rate = rateOfEntry(entry)
  return {
    ...imagesOf(entry.imageTier),
    ...unavailableFields(args.note),
    id: entry.id,
    label: modelLabelOf({ providerId, label: entry.label }),
    provider: providerNameOf(providerId),
    context: contextLabelOf(entry.contextWindow),
    contextTokens: entry.contextWindow,
    efforts: effortsFromNames(entry.efforts),
    fast: entry.fast === true,
    monogram: providerNameOf(providerId).slice(0, 1),
    ...(brand === undefined ? {} : { brand }),
    ...(rate === undefined ? {} : { rate }),
  }
}

export function modelOptionsFromResponse(args: {
  response: ModelsResponse
  currentIds?: readonly string[]
}): ModelOptions {
  const currentIds = args.currentIds ?? []
  const offered = args.response.providers
    .filter((provider) => provider.status !== EModelProviderStatus.Expired)
    .flatMap((provider) => {
      const unavailable = provider.status === EModelProviderStatus.Unavailable
      return provider.models
        .filter((entry) => !unavailable || currentIds.includes(entry.id))
        .map((entry) =>
          optionOfEntry({
            providerId: provider.id,
            entry,
            ...(unavailable ? { note: notConnectedNote(provider.id) } : {}),
          }),
        )
    })
  const optionFor = (id: string): ModelOption => {
    for (const provider of args.response.providers) {
      const entry = provider.models.find((candidate) => candidate.id === id)
      if (entry === undefined) continue
      const note =
        provider.status === EModelProviderStatus.Expired
          ? EXPIRED_NOTE
          : notConnectedNote(provider.id)
      return optionOfEntry({ providerId: provider.id, entry, note })
    }
    const ref = parseRef(id)
    return unknownOption({
      id,
      note: ref === undefined ? undefined : notConnectedNote(ref.providerId),
    })
  }
  const reconnectProviders = args.response.providers
    .filter((provider) => provider.status === EModelProviderStatus.Expired)
    .map((provider) => providerNameOf(provider.id))
  return { models: withCurrent({ offered, currentIds, optionFor }), reconnectProviders }
}

export function modelOptionsOfSource(args: {
  source: ModelsSource | undefined
  currentIds?: readonly string[]
}): ModelOptions {
  const { source, ...rest } = args
  if (source === undefined) return { models: [], reconnectProviders: [] }
  if (source.kind === 'live')
    return modelOptionsFromResponse({ response: source.response, ...rest })
  return modelOptionsOf({ accounts: source.accounts, ...rest })
}
