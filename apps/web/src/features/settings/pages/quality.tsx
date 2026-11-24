'use client'

import type { QualityPolicyDescriptor } from '@dltech/atlas-core'
import { QUALITY_POLICY_DESCRIPTORS } from '@dltech/atlas-plugin-quality/core'

import { QueryPage } from '../data/personal/query-boundary'
import { QualitySkeleton } from '../skeletons/agent-skeletons'
import { ESettingFieldKind, type SettingField } from '../data/personal/setting-fields'
import { useCloudSettings } from '@/lib/cloud-settings'
import { QUALITY_FIELDS } from '../fixtures/settings-fields'
import { SettingFieldsEditor } from '../parts/setting-fields-editor'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Code Quality'
const DESCRIPTION =
  'An advisory review after each file write. Every sandbox loads these when it starts.'

const POLICIES: readonly QualityPolicyDescriptor[] = QUALITY_POLICY_DESCRIPTORS

const policyField = (policy: QualityPolicyDescriptor): SettingField => ({
  kind: ESettingFieldKind.Toggle,
  key: policy.settingKey,
  title: policy.title,
  description: policy.description,
  fallback: policy.defaultEnabled,
})

const FIELDS = [...QUALITY_FIELDS, ...POLICIES.map(policyField)]

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
