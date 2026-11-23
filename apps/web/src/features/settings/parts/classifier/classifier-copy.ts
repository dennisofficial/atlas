import {
  classifierAvailabilityOf,
  DECISION_MODELS,
  decisionModelOf,
  EClassifierOffReason,
  refKeyOf,
  suggestedModelOf,
  type ClassifierAvailability,
  type ClassifierCredential,
  type DecisionModel,
} from '@dltech/atlas-classifier'
import { providerLabelOf, type EAuthProvider } from '@dltech/atlas-core'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { settingString } from '../../data/personal/settings-values'
import { EAccountKind, type Account } from '../../data/personal/accounts-api'
import { EProviderId } from '../../fixtures/settings-agent'

export const CLASSIFIER_MODEL_KEY = 'classifier.model'
export const CLASSIFIER_OFF_VALUE = ''

export type ClassifierSettings = { model: string }

export type ClassifierTestLine =
  | { ok: true; model: string; ms: number }
  | { ok: false; fault: string; detail: string }

export type ClassifierStatus = { tone: 'on' | 'off'; text: string }

export type ClassifierSuggestion = { ref: string; label: string; providerLabel: string }

export type ClassifierFeatureRow = {
  label: string
  state: string
  href: string
  linkLabel: string
}

const labelOf = (provider: string): string => providerLabelOf(provider) ?? provider

export const credentialOfAccounts =
  (accounts: readonly Account[]) =>
  (provider: EAuthProvider): ClassifierCredential | null => {
    const held = accounts.filter((account) => account.provider === provider)
    const apiKey = held.find((account) => account.kind === EAccountKind.ApiKey)
    if (apiKey !== undefined) return { kind: 'api-key', accountId: apiKey.id }
    const plan = held.find((account) => account.kind === EAccountKind.Oauth)
    return plan === undefined ? null : { kind: 'plan', accountId: plan.id }
  }

export const classifierSettingsFrom = (values: SettingValues): ClassifierSettings => {
  return { model: settingString({ values, key: CLASSIFIER_MODEL_KEY }) }
}

export const classifierChanges = (args: {
  saved: ClassifierSettings
  draft: ClassifierSettings
}): SettingChanges => {
  if (args.saved.model === args.draft.model) return {}
  return { [CLASSIFIER_MODEL_KEY]: args.draft.model.length === 0 ? null : args.draft.model }
}

export const classifierAvailabilityIn = (args: {
  stored: string
  accounts: readonly Account[]
}): ClassifierAvailability =>
  classifierAvailabilityOf({
    stored: args.stored.length === 0 ? undefined : args.stored,
    credentialOf: credentialOfAccounts(args.accounts),
  })

export const classifierStatusOf = (availability: ClassifierAvailability): ClassifierStatus => {
  if (availability.on) {
    return { tone: 'on', text: `${labelOf(availability.model.provider)} is connected.` }
  }
  const provider = availability.provider
  if (availability.reason === EClassifierOffReason.NoModel) {
    return {
      tone: 'off',
      text: 'No classifier is set. Skill suggestion and the Jev code review are off.',
    }
  }
  if (availability.reason === EClassifierOffReason.PlanHasNoKey && provider !== undefined) {
    return {
      tone: 'off',
      text: `Off — ${labelOf(provider)} is connected by a plan, which cannot serve a classifier.`,
    }
  }
  if (availability.reason === EClassifierOffReason.NotConnected && provider !== undefined) {
    return { tone: 'off', text: `Off — ${labelOf(provider)} is not connected.` }
  }
  return { tone: 'off', text: `Off — ${availability.reason}.` }
}

export const classifierModelItems = (): { value: string; label: string }[] => [
  { value: CLASSIFIER_OFF_VALUE, label: 'Off' },
  ...DECISION_MODELS.map((model) => ({ value: refKeyOf(model), label: model.label })),
]

export const classifierModelOf = (stored: string): DecisionModel | undefined =>
  stored.length === 0 ? undefined : decisionModelOf(stored)

export const classifierSuggestionOf = (
  accounts: readonly Account[],
): ClassifierSuggestion | undefined => {
  const model = suggestedModelOf({ credentialOf: credentialOfAccounts(accounts) })
  if (model === undefined) return undefined
  return { ref: refKeyOf(model), label: model.label, providerLabel: labelOf(model.provider) }
}

export const classifierTestLineOf = (line: ClassifierTestLine | null): string | undefined => {
  if (line === null) return undefined
  return line.ok ? `● Working — ${line.model}, ${line.ms} ms` : `Off — ${line.detail}`
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

export const providerIdOf = (provider: string): EProviderId => {
  const found = Object.values(EProviderId).find((id) => id === provider)
  if (found === undefined) throw new Error(`no provider id for ${provider}`)
  return found
}

export const classifierPlanOnlyText = (args: { providerLabel: string }): string =>
  args.providerLabel === 'OpenAI'
    ? 'ChatGPT is connected by a plan, which cannot serve a classifier. Add an OpenAI API key.'
    : `${args.providerLabel} is not connected.`
