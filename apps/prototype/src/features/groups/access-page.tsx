'use client'

import { AccessGrantsList } from '../shared/access/access-grants-list'
import { PROJECT_GRANTS } from '../shared/access/fixtures'
import { SettingsPage } from '../settings/settings-layout'
import { InheritedLayersPreview, PERSONAL_LAYER } from './inherited-layers-preview'

export function GroupAccessPage() {
  return (
    <SettingsPage
      title="Access"
      description="Secrets and files every project in this group inherits. A project value with the same name or path wins."
    >
      <InheritedLayersPreview layers={[PERSONAL_LAYER]} />
      <AccessGrantsList grants={PROJECT_GRANTS} />
    </SettingsPage>
  )
}
