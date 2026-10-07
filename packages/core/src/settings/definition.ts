import type { EDefinitionOrigin } from '../discovery/origin'
import type { ESettingsLayer } from './layers'
import { ESettingKind, type SettingOption } from './value'

export enum ESettingPage {
  General = 'general',
  Models = 'models',
  Appearance = 'appearance',
  Experimental = 'experimental',
  Cloud = 'cloud',
  CodeQuality = 'quality',
  Hidden = 'hidden',
}

export type SettingPage = {
  id: ESettingPage
  label: string
}

type SettingFacts = {
  id: string
  page: ESettingPage
  group: string
  label: string
  description: string
  environmentVariable?: string
  writeLayer?: ESettingsLayer.User | ESettingsLayer.Project
}

export type ToggleDefinition = SettingFacts & {
  kind: ESettingKind.Toggle
  fallback: boolean
}

export type ChoiceDefinition = SettingFacts & {
  kind: ESettingKind.Choice
  fallback: string
  options: readonly SettingOption[]
}

export type RangeDefinition = SettingFacts & {
  kind: ESettingKind.Range
  fallback: number
  minimum: number
  maximum: number
  step: number
  unit: string
  /** What the row reads at zero when zero is a named choice rather than an amount — "no limit". */
  zeroLabel?: string
}

export type TextDefinition = SettingFacts & {
  kind: ESettingKind.Text
  fallback: string
}

export type AgentTypeModelSource = {
  name: string
  origin: EDefinitionOrigin
  definedIn?: string | undefined
  overriddenBy?: EDefinitionOrigin | undefined
}

export type ModelDefinition = SettingFacts & {
  kind: ESettingKind.Model
  fallback: string
  unsetLabel?: string
  agentType?: AgentTypeModelSource
}

export type SecretDefinition = SettingFacts & {
  kind: ESettingKind.Secret
  fallback: ''
  masked: boolean
  environmentVariable?: never
}

export type SettingDefinition =
  | ToggleDefinition
  | ChoiceDefinition
  | RangeDefinition
  | TextDefinition
  | ModelDefinition
  | SecretDefinition

export function definitionsOfPage(args: {
  definitions: readonly SettingDefinition[]
  page: ESettingPage
}): readonly SettingDefinition[] {
  return args.definitions.filter((definition) => definition.page === args.page)
}

export function optionOf(args: {
  definition: ChoiceDefinition
  value: string
}): SettingOption | undefined {
  return args.definition.options.find((option) => option.value === args.value)
}
