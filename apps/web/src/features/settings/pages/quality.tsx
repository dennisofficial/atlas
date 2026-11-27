'use client'

import { qualityFieldsOf } from '@dltech/atlas-client/settings'
import { QUALITY_POLICY_DESCRIPTORS } from '@dltech/atlas-plugin-quality/core'

import { QueryPage } from '../data/personal/query-boundary'
import { QualitySkeleton } from '../skeletons/agent-skeletons'
import { useCloudSettings } from '@/lib/cloud-settings'
import { SettingFieldsEditor } from '../parts/setting-fields-editor'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Code Quality'
const DESCRIPTION =
  'An advisory review after each file write. Every sandbox loads these when it starts.'

const FIELDS = qualityFieldsOf(QUALITY_POLICY_DESCRIPTORS)

export function QualityPage() {
  const settings = useCloudSettings()
  return (
    <QueryPage
      query={settings.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<QualitySkeleton />}
    >
      {(values) => (
        <SettingsPage title={TITLE} description={DESCRIPTION}>
          <SettingFieldsEditor
            values={values}
            save={settings.save}
            title="Review"
            description="Turn the review on, then choose which policies it applies."
            fields={FIELDS}
          />
        </SettingsPage>
      )}
    </QueryPage>
  )
}
