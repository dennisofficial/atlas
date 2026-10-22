import { Mono, SettingsSection } from '../settings-layout'
import { CURRENT_USER } from '../../../fixtures/settings'
import {
  ELibraryScope,
  PERSONAL_SECRETS,
  type LibrarySecret,
} from '../../../fixtures/settings-library'
import { SecretsView } from '../parts/library-secrets-view'
import {
  PERSONAL_VERCEL_COPY,
  VercelCredentialCard,
  type VercelCredentialView,
} from '../parts/vercel-credential-card'

export type PersonalVercelState = {
  view?: VercelCredentialView
  statusLine?: string
}

export const PERSONAL_VERCEL_NOT_CONFIGURED: PersonalVercelState = { statusLine: 'Not configured' }

export const PERSONAL_VERCEL_CONFIGURED: PersonalVercelState = {
  view: {
    configured: true,
    teamId: 'team_dennis',
    vercelProjectId: 'prj_personal_sandboxes',
    updatedAt: '2026-10-21T09:00:00.000Z',
  },
  statusLine: 'Configured · updated 3h ago',
}

export function SecretsPage({
  initial = PERSONAL_SECRETS,
  vercel = PERSONAL_VERCEL_NOT_CONFIGURED,
}: {
  initial?: LibrarySecret[]
  vercel?: PersonalVercelState
}) {
  return (
    <SecretsView
      scope={ELibraryScope.Personal}
      description={
        <>
          Delivered to your sandboxes as harness secrets. Workspace values apply first, your
          personal values override them, and project values override both. Manage them from the
          terminal with <Mono className="rounded bg-muted px-1.5 py-0.5">atlas secrets</Mono>.
        </>
      }
      sectionDescription="Only visible to you."
      lead={
        <SettingsSection
          title="Sandbox credential"
          description="Lets Atlas Cloud create sandboxes for your personal projects and for threads without a project."
        >
          <VercelCredentialCard copy={PERSONAL_VERCEL_COPY} {...vercel} />
        </SettingsSection>
      }
      initial={initial}
      currentMember={{ name: CURRENT_USER.name, initials: CURRENT_USER.initials }}
    />
  )
}
