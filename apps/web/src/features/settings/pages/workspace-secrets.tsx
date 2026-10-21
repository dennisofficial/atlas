'use client'

import { ELibraryScope } from '../fixtures/settings-library'
import { QueryGate } from '../data/workspace/query-gate'
import { ReadOnlyArea } from '../data/workspace/read-only-area'
import { useWorkspaceSecretsStore } from '../data/workspace/use-workspace-stores'
import type { WorkspaceAccess } from '../data/workspace/use-workspace-access'
import { pageWrapOf, WorkspaceGate } from '../data/workspace/workspace-gate'
import { describeAccess } from '../data/workspace/workspace-role'
import { SecretsView } from '../parts/library-secrets-view'

const TITLE = 'Secrets & Env Vars'

function LoadedSecrets({ access }: { access: WorkspaceAccess }) {
  const { query, store } = useWorkspaceSecretsStore({
    organizationId: access.organization.id,
    canEdit: access.canEdit,
  })
  const description = describeAccess({
    description: `Shared values for ${access.organization.name}. Project values override these, and a member's personal values override both.`,
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
            sectionDescription="Available to every member's threads."
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
