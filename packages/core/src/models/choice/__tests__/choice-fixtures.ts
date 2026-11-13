import { EImageTier } from '../../../images/projection'
import { catalogOf, type ModelCard } from '../../card'
import type { ModelRef } from '../../ref'
import { capabilitiesFromCatalog, type CapabilitiesOf } from '../capabilities'

const card = (args: {
  providerId: string
  modelId: string
  effort?: ModelCard['effort']
  fast?: true
}): ModelCard => ({
  ref: { providerId: args.providerId, modelId: args.modelId },
  label: args.modelId,
  api: 'anthropic-messages',
  contextWindow: 200_000,
  imageTier: EImageTier.Standard,
  ...(args.effort === undefined ? {} : { effort: args.effort }),
  ...(args.fast === true ? { fast: true } : {}),
})

export const MAIN_REF: ModelRef = { providerId: 'anthropic', modelId: 'claude-opus-5' }
export const SUBAGENT_REF: ModelRef = { providerId: 'anthropic', modelId: 'claude-sonnet-5' }
export const PLAIN_REF: ModelRef = { providerId: 'openai', modelId: 'gpt-5' }
export const GHOST_REF: ModelRef = { providerId: 'openai', modelId: 'ghost-model' }
export const FALLBACK_REF: ModelRef = { providerId: 'anthropic', modelId: 'claude-sonnet-5' }

export const TEST_CATALOG = catalogOf([
  card({ ...MAIN_REF, effort: { low: 'low', medium: 'medium', high: 'high' }, fast: true }),
  card({ ...SUBAGENT_REF, effort: { low: 'low', high: 'high' } }),
  card({ ...PLAIN_REF, effort: { low: 'low', medium: 'medium' } }),
])

export const capabilitiesOf = (
  reachable: (providerId: string) => boolean = () => true,
): CapabilitiesOf => capabilitiesFromCatalog({ catalog: TEST_CATALOG, reachable })

export const readOf =
  (values: Readonly<Record<string, string | boolean>>) =>
  (settingId: string): string | boolean | undefined =>
    values[settingId]
