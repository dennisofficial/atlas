import type { ChoiceItem } from './settings-decisions'
import {
  EAccountKind,
  EProvider,
  PROVIDERS,
  SEVERAL_KEYS_PROVIDERS,
  type ProviderState,
} from './settings-providers'

export const CLASSIFIER_OFF_VALUE = ''

export type Accounts = ProviderState['accounts']

export type DecisionModel = { ref: string; label: string; provider: EProvider }

export enum EClassifierOffReason {
  NoModel = 'no-model',
  PlanHasNoKey = 'plan-has-no-key',
  NotConnected = 'not-connected',
}

export type ClassifierAvailability =
  | { on: true; model: DecisionModel }
  | { on: false; reason: EClassifierOffReason.NoModel }
  | { on: false; reason: EClassifierOffReason.PlanHasNoKey; provider: EProvider }
  | { on: false; reason: EClassifierOffReason.NotConnected; provider: EProvider }

export type ClassifierStatus = { tone: 'on' | 'off'; text: string }

export type ClassifierTest = { ok: boolean; text: string }

export type ClassifierFeatureRow = {
  label: string
  state: string
  href: string
  linkLabel: string
}

export const DECISION_MODELS: readonly DecisionModel[] = [
  { ref: 'typesafe/jev-1', label: 'Jev 1', provider: EProvider.Typesafe },
  { ref: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: EProvider.Anthropic },
  { ref: 'openai/gpt-5-mini', label: 'GPT-5 mini', provider: EProvider.OpenAI },
]

export const CLASSIFIER_DEFAULTS = { model: 'anthropic/claude-haiku-4-5' }

export const CLASSIFIER_ACCOUNTS: Accounts = SEVERAL_KEYS_PROVIDERS.accounts

export const SKILLS_SUGGEST_ENABLED = true

export const QUALITY_ENABLED = true

export const providerNameOf = (provider: EProvider): string =>
  PROVIDERS.find((info) => info.id === provider)?.name ?? provider

export const classifierModelOf = (stored: string): DecisionModel | undefined =>
  stored.length === 0 ? undefined : DECISION_MODELS.find((model) => model.ref === stored)

export const classifierModelItems = (): ChoiceItem<string>[] => [
  { value: CLASSIFIER_OFF_VALUE, label: 'Off' },
  ...DECISION_MODELS.map((model) => ({ value: model.ref, label: model.label })),
]

const credentialKindOf = (args: {
  accounts: Accounts
  provider: EProvider
}): EAccountKind.ApiKey | EAccountKind.Plan | null => {
  const held = args.accounts[args.provider] ?? []
  if (held.some((account) => account.kind === EAccountKind.ApiKey)) return EAccountKind.ApiKey
  if (held.some((account) => account.kind === EAccountKind.Plan)) return EAccountKind.Plan
  return null
}

export const classifierAvailabilityIn = (args: {
  stored: string
  accounts: Accounts
}): ClassifierAvailability => {
  const model = classifierModelOf(args.stored)
  if (model === undefined) return { on: false, reason: EClassifierOffReason.NoModel }
  const kind = credentialKindOf({ accounts: args.accounts, provider: model.provider })
  if (kind === EAccountKind.ApiKey) return { on: true, model }
  if (kind === EAccountKind.Plan) {
    return { on: false, reason: EClassifierOffReason.PlanHasNoKey, provider: model.provider }
  }
  return { on: false, reason: EClassifierOffReason.NotConnected, provider: model.provider }
}

export const classifierStatusOf = (availability: ClassifierAvailability): ClassifierStatus => {
  if (availability.on) {
    return { tone: 'on', text: `${providerNameOf(availability.model.provider)} is connected.` }
  }
  switch (availability.reason) {
    case EClassifierOffReason.NoModel:
      return {
        tone: 'off',
        text: 'No classifier is set. Skill suggestion and the Jev code review are off.',
      }
    case EClassifierOffReason.PlanHasNoKey:
      return {
        tone: 'off',
        text: `Off — ${providerNameOf(availability.provider)} is connected by a plan, which cannot serve a classifier.`,
      }
    case EClassifierOffReason.NotConnected:
      return {
        tone: 'off',
        text: `Off — ${providerNameOf(availability.provider)} is not connected.`,
      }
  }
}

export const classifierTestOf = (availability: ClassifierAvailability): ClassifierTest =>
  availability.on
    ? { ok: true, text: `● Working — ${availability.model.label}, 412 ms` }
    : { ok: false, text: 'Off — no working key for this classifier.' }

export const classifierSuggestionOf = (accounts: Accounts): DecisionModel | undefined =>
  DECISION_MODELS.find(
    (model) => credentialKindOf({ accounts, provider: model.provider }) === EAccountKind.ApiKey,
  )

export const classifierKeyLabelOf = (args: {
  accounts: Accounts
  provider: EProvider
}): string | null => {
  const held = args.accounts[args.provider] ?? []
  const account = held.find((item) => item.kind === EAccountKind.ApiKey) ?? held[0]
  return account === undefined ? null : account.name
}

const featureStateOf = (args: { on: boolean; own: boolean }): string => {
  if (!args.on) return 'Off — no classifier'
  return args.own ? 'On with the classifier' : 'Off — its own switch is off'
}

export const classifierFeaturesOf = (args: {
  on: boolean
  skillsSuggest: boolean
  qualityEnabled: boolean
}): ClassifierFeatureRow[] => [
  {
    label: 'Skill suggestion',
    state: featureStateOf({ on: args.on, own: args.skillsSuggest }),
    href: '/settings/skills',
    linkLabel: 'Skills',
  },
  {
    label: 'Jev code review',
    state: featureStateOf({ on: args.on, own: args.qualityEnabled }),
    href: '/settings/quality',
    linkLabel: 'Code Quality',
  },
]
