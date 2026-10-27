import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRightIcon, PlugIcon, PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'

import { ESettingsPage, hrefOfPage } from '../../settings/settings-nav'
import { EMcpOAuthState, EMcpScope, type McpServer } from '../../settings/fixtures/settings-mcp'
import { LibraryConfirmDialog } from '../../settings/parts/library-confirm-dialog'
import { SettingsCard, SettingsPage, SettingsSection } from '../../settings/settings-layout'
import { EMcpDialogTab, McpDialog } from './mcp-dialog'
import {
  overriddenNames,
  removeServer,
  setConnection,
  setEnabled,
  splitByScope,
  upsertDrafts,
} from './mcp-model'
import { McpRow } from './mcp-row'
import type { McpDraft } from './mcp-import'
import type { ReactNode } from 'react'

export enum EMcpDialog {
  None = 'none',
  Add = 'add',
  PasteJson = 'paste-json',
}

function McpEmpty() {
  return (
    <Empty className="border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugIcon />
        </EmptyMedia>
        <EmptyTitle>No MCP servers</EmptyTitle>
        <EmptyDescription>
          Add a server, or paste a config from Claude Code, Cursor or VS Code.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function GroupEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export function McpView({
  scope,
  initialRows,
  description,
  openDialog = EMcpDialog.None,
  initialJson = '',
}: {
  scope: EMcpScope
  initialRows: readonly McpServer[]
  description: ReactNode
  openDialog?: EMcpDialog
  initialJson?: string
}) {
  const [rows, setRows] = useState<readonly McpServer[]>(initialRows)
  const [addOpen, setAddOpen] = useState(openDialog !== EMcpDialog.None)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [removing, setRemoving] = useState<McpServer | null>(null)

  const overridden = overriddenNames(rows)
  const isProject = scope === EMcpScope.Project
  const { project, personal } = splitByScope(rows)

  const handleSubmit = ({ drafts, target }: { drafts: McpDraft[]; target: EMcpScope }) =>
    setRows((current) => upsertDrafts({ rows: current, drafts, scope: target }))

  const handleRemove = () => {
    if (removing) setRows((current) => removeServer({ rows: current, target: removing }))
    setRemoving(null)
  }

  const handleConnect = (target: McpServer) =>
    setRows((current) =>
      setConnection({
        rows: current,
        target,
        connection: { state: EMcpOAuthState.Connected, account: 'dennis@dltech.dev' },
      }),
    )

  const handleSignOut = (target: McpServer) =>
    setRows((current) =>
      setConnection({
        rows: current,
        target,
        connection: { state: EMcpOAuthState.SignInRequired },
      }),
    )

  const handleToggle = ({ target, enabled }: { target: McpServer; enabled: boolean }) =>
    setRows((current) => setEnabled({ rows: current, target, enabled }))

  const renderRows = ({
    items,
    emptyLabel,
  }: {
    items: readonly McpServer[]
    emptyLabel: string
  }) =>
    items.length === 0 ? (
      <GroupEmpty label={emptyLabel} />
    ) : (
      <SettingsCard>
        {items.map((server) => (
          <McpRow
            key={`${server.scope}-${server.name}`}
            server={server}
            overridesPersonal={server.scope === EMcpScope.Project && overridden.has(server.name)}
            shadowed={server.scope === EMcpScope.Personal && overridden.has(server.name)}
            onToggle={(enabled) => handleToggle({ target: server, enabled })}
            onEdit={() => setEditing(server)}
            onSignIn={() => handleConnect(server)}
            onSignOut={() => handleSignOut(server)}
            onRemove={() => setRemoving(server)}
          />
        ))}
      </SettingsCard>
    )

  return (
    <SettingsPage
      title="MCP"
      description={description}
      actions={
        <>
          {isProject ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              nativeButton={false}
              render={<Link href={hrefOfPage(ESettingsPage.Integrations)} />}
            >
              Personal MCP settings
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon />
            Add MCP server
          </Button>
        </>
      }
    >
      {isProject ? (
        <>
          <SettingsSection title="Project" count={project.length}>
            {renderRows({
              items: project,
              emptyLabel: 'No project servers. Add one, or paste a config.',
            })}
          </SettingsSection>
          <SettingsSection
            title="Personal"
            count={personal.length}
            description="Yours in every project. Changes here apply everywhere."
          >
            {renderRows({ items: personal, emptyLabel: 'No personal servers.' })}
          </SettingsSection>
        </>
      ) : rows.length === 0 ? (
        <McpEmpty />
      ) : (
        renderRows({ items: rows, emptyLabel: '' })
      )}

      <McpDialog
        key={`add-${addOpen}`}
        open={addOpen}
        onOpenChange={setAddOpen}
        scope={scope}
        initial={null}
        initialTab={openDialog === EMcpDialog.PasteJson ? EMcpDialogTab.Json : EMcpDialogTab.Form}
        initialJson={initialJson}
        onSubmit={(drafts) => handleSubmit({ drafts, target: scope })}
      />
      <McpDialog
        key={`edit-${editing?.scope ?? 'none'}-${editing?.name ?? 'none'}`}
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        scope={editing?.scope ?? scope}
        initial={editing}
        onSubmit={(drafts) => handleSubmit({ drafts, target: editing?.scope ?? scope })}
      />
      <LibraryConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={`Remove ${removing?.name ?? 'server'}?`}
        description="New threads stop getting its tools. Running threads keep them until they end."
        confirmLabel="Remove"
        onConfirm={handleRemove}
      />
    </SettingsPage>
  )
}
