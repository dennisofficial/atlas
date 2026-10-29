'use client'

import { defaultsOf, EXPERIMENTAL_FIELDS } from '../fixtures/settings-fields'
import { SettingFieldsEditor } from '../parts/setting-fields'
import { SettingsPage } from '../settings-layout'
import { useDraft } from '../use-draft'

export function ExperimentalPage() {
  const draft = useDraft(defaultsOf(EXPERIMENTAL_FIELDS))
  return (
    <SettingsPage
      title="Experimental"
      description="Behavior still proving itself. Every sandbox loads these when it starts."
    >
      <SettingFieldsEditor
        draft={draft}
        title="Planning and pull requests"
        description="Opt-in planning and CI behavior."
        fields={EXPERIMENTAL_FIELDS}
      />
    </SettingsPage>
  )
}
