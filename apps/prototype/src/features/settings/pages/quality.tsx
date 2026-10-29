'use client'

import { defaultsOf, QUALITY_FIELDS } from '../fixtures/settings-fields'
import { SettingFieldsEditor } from '../parts/setting-fields'
import { SettingsPage } from '../settings-layout'
import { useDraft } from '../use-draft'

export function QualityPage() {
  const draft = useDraft(defaultsOf(QUALITY_FIELDS))
  return (
    <SettingsPage
      title="Code Quality"
      description="An advisory review after each file write. Every sandbox loads these when it starts."
    >
      <SettingFieldsEditor
        draft={draft}
        title="Review"
        description="Turn the review on, then choose which policies it applies."
        fields={QUALITY_FIELDS}
      />
    </SettingsPage>
  )
}
