'use client'

import { QueryGate } from '../data/workspace/query-gate'
import { ReadOnlyArea } from '../data/workspace/read-only-area'
import { useWorkspaceMcpStore } from '../data/workspace/use-workspace-stores'
import type { WorkspaceAccess } from '../data/workspace/use-workspace-access'
import { pageWrapOf, WorkspaceGate } from '../data/workspace/workspace-gate'
import { describeAccess } from '../data/workspace/workspace-role'
import { McpServersSection } from '../parts/mcp-servers-section'
import { McpSuggested } from '../parts/mcp-suggested'
import { SettingsPage } from '../settings-layout'

const TITLE = 'MCP'

function LoadedMcp({ access }: { access: WorkspaceAccess }) {
  const { ready, store } = useWorkspaceMcpStore({
    organizationId: access.organization.id,
    canEdit: access.canEdit,
  })
  const pageDescription = `Tools shared with everyone in ${access.organization.name}.`
  return (
    <QueryGate
      query={ready}
      label="workspace MCP servers"
      wrap={pageWrapOf({ title: TITLE, description: pageDescription })}
    >
      {() => (
        <SettingsPage title={TITLE} description={pageDescription}>
          <ReadOnlyArea canEdit={access.canEdit}>
            <div className="flex flex-col gap-8">
              <McpServersSection
                description={describeAccess({
                  description:
                    'Workspace MCP servers are available to every member; project servers with the same id override them, and personal servers override both.',
                  canEdit: access.canEdit,
                })}
                store={store}
              />
              <McpSuggested />
            </div>
          </ReadOnlyArea>
        </SettingsPage>
      )}
    </QueryGate>
  )
}

export function WorkspaceMcpPage() {
  return <WorkspaceGate title={TITLE}>{(access) => <LoadedMcp access={access} />}</WorkspaceGate>
}
