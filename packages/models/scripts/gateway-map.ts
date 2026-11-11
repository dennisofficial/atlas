import {
  GATEWAY_API,
  GATEWAY_CATALOGUE_PROVIDER_ID,
  type GeneratedCard,
} from '../src/generated-card'
import { literalRungs } from './catalogue-effort'
import {
  ENote,
  ESkipReason,
  imageTierFor,
  readsHighResolution,
  tally,
  type ProviderMapping,
} from './catalogue-report'
import type { GatewayModel } from './vercel-gateway'

const LANGUAGE_TYPE = 'language'
const TOOL_USE_TAG = 'tool-use'

/**
 * The gateway lists each model's batch twin as its own id; those are served by the batch API only
 * and refuse a streamed language-model call. https://vercel.com/docs/ai-gateway/capabilities/batch
 */
const BATCH_SUFFIX = '-batch'

const PER_MILLION = 1_000_000

/**
 * The gateway prices per token as a decimal string, so scaling to a per-million figure lands on
 * binary-float noise like 2.0999999999999996 unless it is rounded.
 */
const PRICE_PRECISION = 1_000_000

function perMillion(price: string | undefined): number | undefined {
  if (price === undefined) return undefined

  const perToken = Number(price)
  if (!Number.isFinite(perToken)) return undefined
  return Math.round(perToken * PER_MILLION * PRICE_PRECISION) / PRICE_PRECISION
}

const vendorModelId = (modelId: string): string =>
  (modelId.split('/').pop() ?? modelId).replaceAll('.', '-')

function costOf(model: GatewayModel): GeneratedCard['cost'] {
  const inputPerMillion = perMillion(model.pricing?.input)
  const outputPerMillion = perMillion(model.pricing?.output)
  if (inputPerMillion === undefined || outputPerMillion === undefined) return undefined

  const cacheReadPerMillion = perMillion(model.pricing?.input_cache_read)
  const cacheWritePerMillion = perMillion(model.pricing?.input_cache_write)
  return {
    inputPerMillion,
    outputPerMillion,
    ...(cacheReadPerMillion === undefined ? {} : { cacheReadPerMillion }),
    ...(cacheWritePerMillion === undefined ? {} : { cacheWritePerMillion }),
  }
}

function effortOf(model: GatewayModel): GeneratedCard['effort'] {
  const literals = (model.reasoning_options ?? []).find((option) => option.type === 'effort')
  return literals === undefined ? undefined : literalRungs(literals.values ?? [])
}

function cardFor(model: GatewayModel): GeneratedCard | undefined {
  const contextWindow = model.context_window
  if (contextWindow === undefined || contextWindow <= 0) return undefined

  const maxOutputTokens = model.max_tokens
  const cost = costOf(model)
  const effort = effortOf(model)

  return {
    ref: { providerId: GATEWAY_CATALOGUE_PROVIDER_ID, modelId: model.id },
    label: model.name ?? model.id,
    api: GATEWAY_API,
    contextWindow,
    imageTier: imageTierFor(vendorModelId(model.id)),
    ...(model.modalities === undefined ? {} : { inputModalities: model.modalities.input }),
    ...(maxOutputTokens === undefined || maxOutputTokens <= 0 ? {} : { maxOutputTokens }),
    ...(cost === undefined ? {} : { cost }),
    ...(effort === undefined ? {} : { effort }),
  }
}

function skipReasonOf(model: GatewayModel): ESkipReason | undefined {
  if (model.type !== LANGUAGE_TYPE) return ESkipReason.NotLanguage
  if (model.id.endsWith(BATCH_SUFFIX)) return ESkipReason.BatchOnly
  if (!(model.tags ?? []).includes(TOOL_USE_TAG)) return ESkipReason.NoToolCall
  return undefined
}

function noteCard({
  card,
  notes,
}: {
  card: GeneratedCard
  notes: Partial<Record<ENote, number>>
}): void {
  if (card.cost === undefined) tally({ counts: notes, key: ENote.CostMissing })
  if (!readsHighResolution(vendorModelId(card.ref.modelId))) {
    tally({ counts: notes, key: ENote.ImageTierDefaulted })
  }
  if (card.effort === undefined) tally({ counts: notes, key: ENote.NoReasoningControl })
}

export function mapGatewayModels(models: readonly GatewayModel[]): ProviderMapping {
  const skipped: Partial<Record<ESkipReason, number>> = {}
  const notes: Partial<Record<ENote, number>> = {}

  const cards: GeneratedCard[] = []
  for (const model of [...models].sort((left, right) => left.id.localeCompare(right.id))) {
    const reason = skipReasonOf(model)
    if (reason !== undefined) {
      tally({ counts: skipped, key: reason })
      continue
    }

    const card = cardFor(model)
    if (card === undefined) {
      tally({ counts: skipped, key: ESkipReason.NoContextWindow })
      continue
    }

    noteCard({ card, notes })
    cards.push(card)
  }

  return {
    cards,
    report: {
      providerId: GATEWAY_CATALOGUE_PROVIDER_ID,
      api: GATEWAY_API,
      kept: cards.length,
      skipped,
      notes,
    },
  }
}
