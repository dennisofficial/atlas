import type { SettingScalar } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { diffChanges } from './settings-values'

export enum ESettingFieldKind {
  Toggle = 'toggle',
  Choice = 'choice',
  Range = 'range',
  Text = 'text',
}

type FieldBase = {
  key: string
  title: string
  description: string
}

export type SettingField =
  | (FieldBase & { kind: ESettingFieldKind.Toggle; fallback: boolean })
  | (FieldBase & {
      kind: ESettingFieldKind.Choice
      fallback: string
      options: ReadonlyArray<{ value: string; label: string }>
    })
  | (FieldBase & {
      kind: ESettingFieldKind.Range
      fallback: number
      min: number
      max: number
      step: number
      unit: string
    })
  | (FieldBase & {
      kind: ESettingFieldKind.Text
      fallback: string
      placeholder?: string
    })

export type FieldValues = Record<string, SettingScalar>

export function fieldValuesFrom(args: {
  fields: readonly SettingField[]
  values: SettingValues
}): FieldValues {
  const result: FieldValues = {}
  for (const field of args.fields) {
    const stored = args.values.get(field.key)
    result[field.key] =
      typeof stored === typeof field.fallback ? (stored ?? field.fallback) : field.fallback
  }
  return result
}

export function fieldChanges(args: { saved: FieldValues; draft: FieldValues }): SettingChanges {
  return diffChanges({ saved: args.saved, draft: args.draft })
}
