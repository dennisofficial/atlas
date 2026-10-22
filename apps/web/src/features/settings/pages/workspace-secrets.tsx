'use client'

import { ELibraryScope } from '../fixtures/settings-library'
import { QueryGate } from '../data/workspace/query-gate'
import { ReadOnlyArea } from '../data/workspace/read-only-area'
import { useWorkspaceSecretsStore } from '../data/workspace/use-workspace-stores'
import type { WorkspaceAccess } from '../data/workspace/use-workspace-access'
import { pageWrapOf, WorkspaceGate } from '../data/workspace/workspace-gate'
import { describeAccess } from '../data/workspace/workspace-role'
import { SettingsSection } from '../settings-layout'
import { SecretsView } from '../parts/library-secrets-view'
import { WorkspaceVercelCardSlot } from '../parts/vercel-credential-card-live'

const TITLE = 'Secrets & Env Vars'

function LoadedSecrets({ access }: { access: WorkspaceAccess }) {
  const { query, store } = useWorkspaceSecretsStore({
    organizationId: access.organization.id,
    canEdit: access.canEdit,
  })
  const description = describeAccess({
    description: `Shared values for ${access.organization.name}. A member's personal values override these, and project values override both. They don't reach sessions yet.`,
    canEdit: access.canEdit,
  })
  return (
    <QueryGate
      query={query}
      label="workspace secrets"
      wrap={pageWrapOf({ title: TITLE, description })}
    >
      {() => (
        <ReadOnlyArea canEdit={access.canEdit}>
          <SecretsView
            scope={ELibraryScope.Workspace}
            description={description}
            sectionDescription="Saved for every member of the workspace."
            lead={
              <SettingsSection
                title="Sandbox credential"
                description="Lets Atlas Cloud create this workspace's sandboxes."
              >
                <WorkspaceVercelCardSlot
                  organizationId={access.organization.id}
                  canEdit={access.canEdit}
                />
              </SettingsSection>
            }
            store={store}
          />
        </ReadOnlyArea>
      )}
    </QueryGate>
  )
}

export function WorkspaceSecretsPage() {
  return (
    <WorkspaceGate title={TITLE}>{(access) => <LoadedSecrets access={access} />}</WorkspaceGate>
  )
}
