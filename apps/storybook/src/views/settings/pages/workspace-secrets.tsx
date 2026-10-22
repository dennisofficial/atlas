import { CURRENT_USER } from '../../../fixtures/settings'
import {
  ELibraryScope,
  WORKSPACE_SECRETS,
  type LibrarySecret,
} from '../../../fixtures/settings-library'
import { SecretsView } from '../parts/library-secrets-view'
import { VercelCredentialCard, type VercelCredentialView } from '../parts/vercel-credential-card'
import { SettingsSection } from '../settings-layout'

const READ_ONLY_NOTE = 'Only owners and admins can change this.'

export type WorkspaceVercelState = {
  view?: VercelCredentialView
  statusLine?: string
  soon?: boolean
}

export const VERCEL_NOT_CONFIGURED: WorkspaceVercelState = { statusLine: 'Not configured' }

export const VERCEL_CONFIGURED: WorkspaceVercelState = {
  view: {
    configured: true,
    teamId: 'team_dltech',
    vercelProjectId: 'prj_atlas_cloud',
    updatedAt: '2026-10-21T09:00:00.000Z',
  },
  statusLine: 'Configured · updated 3h ago',
}

export function WorkspaceSecretsPage({
  initial = WORKSPACE_SECRETS,
  vercel = VERCEL_NOT_CONFIGURED,
  readOnly = false,
}: {
  initial?: LibrarySecret[]
  vercel?: WorkspaceVercelState
  readOnly?: boolean
}) {
  const base =
    "Shared values for DL Tech. A member's personal values override these, and project values override both. They don't reach sessions yet."
  const card = <VercelCredentialCard {...vercel} disabled={readOnly || vercel.soon === true} />
  const view = (
    <SecretsView
      scope={ELibraryScope.Workspace}
      description={readOnly ? `${base} ${READ_ONLY_NOTE}` : base}
      sectionDescription="Saved for every member of the workspace."
      lead={
        <SettingsSection
          title="Sandbox credential"
          description="Lets Atlas Cloud create this workspace's sandboxes."
        >
          {card}
        </SettingsSection>
      }
      initial={initial}
      currentMember={{ name: CURRENT_USER.name, initials: CURRENT_USER.initials }}
    />
  )
  if (!readOnly) return view
  return (
    <div inert className="opacity-70">
      {view}
    </div>
  )
}
