import {
  QUALITY_FIELDS,
  fieldChanges,
  fieldValuesFrom,
  qualityFieldsOf,
} from '@dltech/atlas-client/settings'
import { QUALITY_POLICY_DESCRIPTORS } from '@dltech/atlas-plugin-quality/core'
import type { SettingScalar } from '@dltech/atlas-wire/web'

import { Section } from '../../../settings/settings-parts'
import { SettingFieldRows } from '../../../settings/setting-field-rows'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'

const FIELDS = qualityFieldsOf(QUALITY_POLICY_DESCRIPTORS)

export default function QualityScreen() {
  const settings = useSettings()
  const fields = fieldValuesFrom({ fields: FIELDS, values: settings.values })

  const handleField = (args: { key: string; next: SettingScalar }) => {
    void settings
      .save(fieldChanges({ saved: fields, draft: { ...fields, [args.key]: args.next } }))
      .catch(() => undefined)
  }

  return (
    <SettingsScroll>
      <Section title="Review">
        <SettingFieldRows fields={QUALITY_FIELDS} value={fields} onChange={handleField} />
      </Section>
      <Section title="Policies">
        <SettingFieldRows
          fields={FIELDS.filter((field) => !QUALITY_FIELDS.includes(field))}
          value={fields}
          onChange={handleField}
        />
      </Section>
    </SettingsScroll>
  )
}
