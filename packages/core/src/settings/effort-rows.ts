import { EFFORT_LADDER, type EEffort } from '../models/effort-ladder'
import type { SettingOption } from './value'

export const INHERIT_EFFORT = ''

const inheritOption: SettingOption = { value: INHERIT_EFFORT, label: 'inherit' }

export const EFFORT_OPTIONS_WITH_INHERIT: readonly SettingOption[] = [
  inheritOption,
  ...EFFORT_LADDER.map((effort) => ({ value: effort, label: effort })),
]

export const withInherit = (rungs: readonly EEffort[]): readonly SettingOption[] => [
  inheritOption,
  ...rungs.map((effort) => ({ value: effort, label: effort })),
]

export const effortRungOf = (value: string): EEffort | undefined =>
  EFFORT_LADDER.find((effort) => effort === value)
