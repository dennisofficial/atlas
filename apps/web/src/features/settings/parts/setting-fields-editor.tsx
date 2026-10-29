'use client'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { fieldChanges, fieldValuesFrom, type SettingField } from '../data/personal/setting-fields'
import { useSettingsDraft } from '../data/personal/use-settings-draft'
import { SettingsCard, SettingsSection } from '../settings-layout'
import { ConfigFooter } from './agent-config-footer'
import { SettingFieldRows } from './setting-fields'

export function SettingFieldsEditor({
  values,
  save,
  title,
  description,
  fields,
}: {
  values: SettingValues
  save: (changes: SettingChanges) => Promise<void>
  title: string
  description: string
  fields: SettingField[]
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: (all) => fieldValuesFrom({ fields, values: all }),
    toChanges: fieldChanges,
    save,
  })
  return (
    <>
      <SettingsSection title={title} description={description}>
        <SettingsCard>
          <SettingFieldRows fields={fields} value={draft.value} onChange={draft.setValue} />
        </SettingsCard>
      </SettingsSection>
      <ConfigFooter
        dirty={draft.dirty && !saving}
        onDiscard={draft.discard}
        onSave={() => void handleSave()}
      />
    </>
  )
}
