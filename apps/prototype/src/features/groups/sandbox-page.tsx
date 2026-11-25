'use client'

import { SandboxPage } from '../project-settings/sandbox-page'
import { SettingsPage } from '../settings/settings-layout'
import { InheritedLayersPreview, PERSONAL_SANDBOX_LAYER } from './inherited-layers-preview'

export function GroupSandboxPage() {
  return (
    <SettingsPage
      title="Sandbox"
      description="A project in this group boots with these sizes unless the project sets its own."
    >
      <InheritedLayersPreview layers={[PERSONAL_SANDBOX_LAYER]} />
      <SandboxPage />
    </SettingsPage>
  )
}
