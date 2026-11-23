import {
  capabilitiesFromCatalog,
  EAuthProvider,
  EEffort,
  EModelRole,
  EStalePolicy,
  effortRungOf,
  parseRef,
  resolveModelChoice,
  type CapabilitiesOf,
  type ModelCapabilities,
  type ModelChoice,
  type ModelRef,
} from '@dltech/atlas-core'
import {
  chosenFor,
  parsedAccountsOf,
  reachableOf,
  type AccountRowLike,
  type ActiveAccountRowLike,
  type ParsedAccount,
} from '@dltech/atlas-credentials'

import { cardsForProvider, generatedCatalogue } from './generated-catalogue'

export const SHIPPED_DEFAULT_REF: ModelRef = {
  providerId: 'anthropic',
  modelId: 'claude-haiku-4-5',
}

const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'
const FALLBACK_PROVIDERS = [
  EAuthProvider.Anthropic,
  EAuthProvider.OpenAI,
  EAuthProvider.OpenRouter,
  EAuthProvider.Gateway,
  EAuthProvider.Inference,
]

export type SessionModelInputs = {
  settings: ReadonlyMap<string, string>
  accounts: readonly AccountRowLike[]
  activeAccounts: readonly ActiveAccountRowLike[]
}

export type SessionModelAsk = {
  ref?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
}

export type SettingReader = (settingId: string) => string | boolean | undefined

const decodeSettingValue = (stored: string): unknown => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    return JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
  } catch {
    return stored
  }
}

export const readOf =
  (settings: ReadonlyMap<string, string>): SettingReader =>
  (settingId) => {
    const stored = settings.get(settingId)
    if (stored === undefined) return undefined
    const decoded = decodeSettingValue(stored)
    return typeof decoded === 'string' || typeof decoded === 'boolean' ? decoded : undefined
  }

export const settingsWithProjectOverUser = (args: {
  user: ReadonlyMap<string, string>
  project: ReadonlyMap<string, string>
}): ReadonlyMap<string, string> => new Map([...args.user, ...args.project])

export const fallbackRefOf = (args: {
  parsed: readonly ParsedAccount<AccountRowLike>[]
  activeAccounts: readonly ActiveAccountRowLike[]
}): ModelRef | undefined => {
  if (chosenFor({ ...args, provider: EAuthProvider.Anthropic }) !== undefined) {
    return SHIPPED_DEFAULT_REF
  }
  for (const provider of FALLBACK_PROVIDERS) {
    if (chosenFor({ ...args, provider }) === undefined) continue
    const card = cardsForProvider(provider)[0]
    if (card !== undefined) return card.ref
  }
  return undefined
}

const UNCATALOGUED: ModelCapabilities = { efforts: [], fast: false, runnable: true }

export const capabilitiesOver = (reachable: (providerId: string) => boolean): CapabilitiesOf => {
  const fromCatalog = capabilitiesFromCatalog({ catalog: generatedCatalogue(), reachable })
  return (ref) => fromCatalog(ref) ?? (reachable(ref.providerId) ? UNCATALOGUED : undefined)
}

const effortOf = (value: string | undefined): EEffort | undefined =>
  value === undefined ? undefined : effortRungOf(value)

type Resolution = {
  read: SettingReader
  capabilitiesOf: CapabilitiesOf
  fallback: ModelRef
}

const resolutionOf = (inputs: SessionModelInputs): Resolution => {
  const parsed = parsedAccountsOf(inputs.accounts)
  const reachable = reachableOf({ parsed, activeAccounts: inputs.activeAccounts })
  return {
    read: readOf(inputs.settings),
    capabilitiesOf: capabilitiesOver(reachable),
    fallback:
      fallbackRefOf({ parsed, activeAccounts: inputs.activeAccounts }) ?? SHIPPED_DEFAULT_REF,
  }
}

const choiceOf = (args: { resolution: Resolution; root: ModelChoice }): ModelChoice => {
  const resolved = resolveModelChoice({
    role: EModelRole.Main,
    read: args.resolution.read,
    capabilitiesOf: args.resolution.capabilitiesOf,
    fallback: args.resolution.fallback,
    stale: EStalePolicy.Keep,
    root: args.root,
  })
  return { ref: resolved.ref, effort: resolved.effort, fast: resolved.fast }
}

export const defaultMainModelOf = (inputs: SessionModelInputs): ModelChoice => {
  const resolution = resolutionOf(inputs)
  const resolved = resolveModelChoice({
    role: EModelRole.Main,
    read: resolution.read,
    capabilitiesOf: resolution.capabilitiesOf,
    fallback: resolution.fallback,
    stale: EStalePolicy.Keep,
  })
  return { ref: resolved.ref, effort: resolved.effort, fast: resolved.fast }
}

export const sessionModelOf = (
  args: SessionModelInputs & { ask: SessionModelAsk; current?: ModelChoice | undefined },
): ModelChoice => {
  const resolution = resolutionOf(args)
  const fallback = defaultMainModelOf(args)
  if (args.ask.ref === undefined) {
    return choiceOf({
      resolution,
      root: {
        ref: fallback.ref,
        effort: effortOf(args.ask.effort) ?? fallback.effort,
        fast: args.ask.fast ?? fallback.fast,
      },
    })
  }
  const ref = parseRef(args.ask.ref)
  if (ref === undefined) throw new Error(`unknown model ${args.ask.ref}`)
  return choiceOf({
    resolution,
    root: {
      ref,
      effort: effortOf(args.ask.effort) ?? args.current?.effort ?? fallback.effort,
      fast: args.ask.fast ?? false,
    },
  })
}
