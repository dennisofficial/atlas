'use client'

import { QueryPage } from '../data/personal/query-boundary'
import { usePersonalSettings } from '../data/personal/use-settings-draft'
import { EXPERIMENTAL_FIELDS } from '../fixtures/settings-fields'
import { SettingFieldsEditor } from '../parts/setting-fields-editor'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Experimental'
const DESCRIPTION = 'Behavior still proving itself. Every sandbox loads these when it starts.'

export function ExperimentalPage() {
  const settings = usePersonalSettings()
  return (
    <QueryPage query={settings.query} title={TITLE} description={DESCRIPTION}>
      {(values) => (
        <SettingsPage title={TITLE} description={DESCRIPTION}>
          <SettingFieldsEditor
            values={values}
            save={settings.save}
            title="Planning and pull requests"
            description="Opt-in planning and CI behavior."
            fields={EXPERIMENTAL_FIELDS}
          />
        </SettingsPage>
      )}
    </QueryPage>
  )
}
