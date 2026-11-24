import { ESettingId, textValueOf, type SettingsResolution } from '@dltech/atlas-core'

import { activeOf, type ProviderRow } from '../ui/accounts-model'
import { EOnboardingRow, type OnboardingRowView } from '../ui/onboarding-model'

export { EOnboardingRow }
export type { OnboardingRowView }

const MODEL_ROWS: readonly { key: EOnboardingRow; id: ESettingId; label: string }[] = [
  { key: EOnboardingRow.Default, id: ESettingId.ModelId, label: 'Default model' },
  { key: EOnboardingRow.Quick, id: ESettingId.QuickModel, label: 'Quick calls' },
  { key: EOnboardingRow.Compaction, id: ESettingId.CompactionModel, label: 'Compaction' },
  { key: EOnboardingRow.Subagents, id: ESettingId.SubagentModel, label: 'Sub-agents' },
]

export const modelRowOf = (key: EOnboardingRow): { id: ESettingId } | undefined =>
  MODEL_ROWS.find((row) => row.key === key)

export const onboardingDue = (args: { rows: readonly ProviderRow[] }): boolean =>
  !args.rows.some((row) => activeOf(row) !== undefined)

export const onboardingRowsOf = (args: {
  rows: readonly ProviderRow[]
  resolution: SettingsResolution
}): readonly OnboardingRowView[] => {
  const connected = args.rows.filter((row) => activeOf(row) !== undefined).length

  const accountRow: OnboardingRowView = {
    key: EOnboardingRow.Accounts,
    label: 'Provider accounts',
    value: connected === 0 ? 'none yet — connect one' : `${connected} connected`,
    done: connected > 0,
  }

  const modelRows = MODEL_ROWS.map((row): OnboardingRowView => {
    const held = textValueOf({ resolution: args.resolution, id: row.id })
    return {
      key: row.key,
      label: row.label,
      value: held.length > 0 ? held : 'not set',
      done: held.length > 0,
    }
  })

  const ready = accountRow.done && modelRows.every((row) => row.done)

  return [
    accountRow,
    ...modelRows,
    {
      key: EOnboardingRow.Begin,
      label: 'Begin',
      value: ready ? 'start atlas' : 'pick the four models above first',
      done: ready,
    },
  ]
}
