'use client'

import { ESecretsScope } from '../fixtures/settings-library'
import {
  WORKSPACE_PROFILE,
  WORKSPACE_SECRETS,
  WORKSPACE_VERCEL_STATUS,
  WORKSPACE_VERCEL_VIEW,
} from '../fixtures/settings-workspace'
import { SettingsSection } from '../settings-layout'
import { VercelCredentialCard } from '../parts/vercel-credential-card'
import { SecretsView } from '../../shared/secrets/secrets-view'

export function WorkspaceSecretsPage() {
  return (
    <div className="flex flex-col gap-8">
      <SecretsView
        scope={ESecretsScope.Workspace}
        initialRows={WORKSPACE_SECRETS}
        description={`Shared values for ${WORKSPACE_PROFILE.name}. A member's personal values override these, and project values override both.`}
      />
      <SettingsSection
        title="Sandbox credential"
        description="Lets Atlas Cloud create this workspace's sandboxes."
      >
        <VercelCredentialCard view={WORKSPACE_VERCEL_VIEW} statusLine={WORKSPACE_VERCEL_STATUS} />
      </SettingsSection>
    </div>
  )
}
