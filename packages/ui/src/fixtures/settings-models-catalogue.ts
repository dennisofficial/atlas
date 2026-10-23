import { EEffort, EFFORT_LADDER } from '../ai/model-selector'
import { EBrand } from '#components/brand-mark'

import CATALOGUE from './model-catalogue-full.json'
import { EProviderId } from './settings-agent'

type RawRow = {
  ref: { providerId: string; modelId: string }
  label: string
  contextWindow: number
  imageTier: string
  images?: boolean
  efforts: string[]
  cost: { input: number; output: number } | null
  canonical: string
}

export type ModelCost = { input: number; output: number }

export type CatalogueRow = {
  ref: string
  provider: EProviderId
  modelId: string
  label: string
  contextWindow: number
  images: boolean
  efforts: EEffort[]
  cost: ModelCost | null
}

export type CatalogueModel = {
  key: string
  label: string
  vendor: string
  rows: CatalogueRow[]
}

const RAW_ROWS: RawRow[] = CATALOGUE

const GATEWAY_ROWS: RawRow[] = [
  {
    ref: { providerId: 'gateway', modelId: 'xai/grok-4' },
    label: 'Grok 4',
    contextWindow: 256000,
    imageTier: 'standard',
    efforts: ['low', 'medium', 'high'],
    cost: { input: 3, output: 15 },
    canonical: 'x-ai/grok-4',
  },
  {
    ref: { providerId: 'gateway', modelId: 'anthropic/claude-opus-4.7' },
    label: 'Claude Opus 4.7',
    contextWindow: 1000000,
    imageTier: 'high-resolution',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    cost: { input: 5, output: 25 },
    canonical: 'anthropic/claude-opus-4-7',
  },
  {
    ref: { providerId: 'gateway', modelId: 'anthropic/claude-sonnet-4.6' },
    label: 'Claude Sonnet 4.6',
    contextWindow: 1000000,
    imageTier: 'standard',
    efforts: ['low', 'medium', 'high', 'max'],
    cost: { input: 3, output: 15 },
    canonical: 'anthropic/claude-sonnet-4-6',
  },
  {
    ref: { providerId: 'gateway', modelId: 'openai/gpt-5' },
    label: 'GPT-5',
    contextWindow: 400000,
    imageTier: 'standard',
    efforts: ['minimal', 'low', 'medium', 'high'],
    cost: { input: 1.25, output: 10 },
    canonical: 'openai/gpt-5',
  },
  {
    ref: { providerId: 'gateway', modelId: 'google/gemini-2.5-pro' },
    label: 'Gemini 2.5 Pro',
    contextWindow: 1048576,
    imageTier: 'standard',
    efforts: ['low', 'medium', 'high'],
    cost: { input: 1.25, output: 10 },
    canonical: 'google/gemini-2-5-pro',
  },
]

const RELEASE_STAMP = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/

const HIGH_RESOLUTION = 'high-resolution'

const DIRECT_PROVIDERS = [EProviderId.Anthropic, EProviderId.OpenAI]

const FAMILY_BRANDS: Record<string, EBrand> = {
  anthropic: EBrand.Claude,
  openai: EBrand.OpenAI,
  google: EBrand.Gemini,
}

export type FamilyMark = { brand: EBrand | undefined; monogram: string }

export function familyMark(vendor: string): FamilyMark {
  return { brand: FAMILY_BRANDS[vendor], monogram: vendor.slice(0, 1).toUpperCase() }
}

const toProvider = (id: string): EProviderId | undefined =>
  Object.values(EProviderId).find((provider) => provider === id)

const toEfforts = (efforts: string[]): EEffort[] =>
  EFFORT_LADDER.filter((rung) => efforts.includes(rung))

const cleanLabel = (label: string): string =>
  label
    .replace(/\s*\(latest\)$/, '')
    .replace(/\s+/g, ' ')
    .trim()

function isDatedDuplicate({ raw, ids }: { raw: RawRow; ids: Set<string> }): boolean {
  const { providerId, modelId } = raw.ref
  return (
    RELEASE_STAMP.test(modelId) && ids.has(`${providerId}/${modelId.replace(RELEASE_STAMP, '')}`)
  )
}

function toRow(raw: RawRow): CatalogueRow | undefined {
  const provider = toProvider(raw.ref.providerId)
  if (provider === undefined) return undefined
  return {
    ref: `${raw.ref.providerId}/${raw.ref.modelId}`,
    provider,
    modelId: raw.ref.modelId,
    label: cleanLabel(raw.label),
    contextWindow: raw.contextWindow,
    images: raw.images ?? raw.imageTier === HIGH_RESOLUTION,
    efforts: toEfforts(raw.efforts),
    cost: raw.cost,
  }
}

function toModel({ key, rows }: { key: string; rows: CatalogueRow[] }): CatalogueModel {
  const display =
    rows.find((row) => DIRECT_PROVIDERS.includes(row.provider)) ??
    rows.find((row) => row.provider === EProviderId.OpenRouter) ??
    rows[0]
  return { key, label: display?.label ?? key, vendor: key.split('/')[0] ?? key, rows }
}

const VENDOR_PRIORITY = [
  'anthropic',
  'openai',
  'google',
  'x-ai',
  'deepseek',
  'moonshotai',
  'z-ai',
  'qwen',
  'meta-llama',
  'mistralai',
]

const vendorRank = (vendor: string): number => {
  const rank = VENDOR_PRIORITY.indexOf(vendor)
  return rank === -1 ? VENDOR_PRIORITY.length : rank
}

function compareModels(a: CatalogueModel, b: CatalogueModel): number {
  return vendorRank(a.vendor) - vendorRank(b.vendor) || a.label.localeCompare(b.label)
}

function buildModels(): CatalogueModel[] {
  const all = [...RAW_ROWS, ...GATEWAY_ROWS]
  const ids = new Set(all.map((raw) => `${raw.ref.providerId}/${raw.ref.modelId}`))
  const grouped = new Map<string, CatalogueRow[]>()
  for (const raw of all) {
    if (isDatedDuplicate({ raw, ids })) continue
    const row = toRow(raw)
    if (row) grouped.set(raw.canonical, [...(grouped.get(raw.canonical) ?? []), row])
  }
  return [...grouped].map(([key, rows]) => toModel({ key, rows })).sort(compareModels)
}

export const CATALOGUE_MODELS: CatalogueModel[] = buildModels()

export const MODEL_BY_KEY = new Map(CATALOGUE_MODELS.map((model) => [model.key, model]))

export const MODEL_BY_REF = new Map(
  CATALOGUE_MODELS.flatMap((model) => model.rows.map((row) => [row.ref, model] as const)),
)

export const ROW_BY_REF = new Map(
  CATALOGUE_MODELS.flatMap((model) => model.rows.map((row) => [row.ref, row] as const)),
)

export const CATALOGUE_ROW_COUNT = RAW_ROWS.length

export function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`
  return `${Math.round(tokens / 1000)}k`
}

const trimmed = (value: number): string => String(Math.round(value * 100) / 100)

export function priceLabel(cost: ModelCost | null): string | undefined {
  if (cost === null) return undefined
  if (cost.input === 0 && cost.output === 0) return 'Free'
  return `$${trimmed(cost.input)} / $${trimmed(cost.output)}`
}
