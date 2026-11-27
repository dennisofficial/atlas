import { EXPERIMENTAL_FIELDS, fieldChanges, fieldValuesFrom } from '@dltech/atlas-client/settings'
import type { SettingScalar } from '@dltech/atlas-wire/web'

import { Section } from '../../../settings/settings-parts'
import { SettingFieldRows } from '../../../settings/setting-field-rows'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'

export default function ExperimentalScreen() {
  const settings = useSettings()
  const fields = fieldValuesFrom({ fields: EXPERIMENTAL_FIELDS, values: settings.values })

  const handleField = (args: { key: string; next: SettingScalar }) => {
    void settings
      .save(fieldChanges({ saved: fields, draft: { ...fields, [args.key]: args.next } }))
      .catch(() => undefined)
  }

  return (
    <SettingsScroll>
      <Section title="Planning and pull requests">
        <SettingFieldRows fields={EXPERIMENTAL_FIELDS} value={fields} onChange={handleField} />
      </Section>
    </SettingsScroll>
  )
}
