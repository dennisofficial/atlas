'use client'

import Link from 'next/link'
import { ArrowUpRightIcon, EllipsisIcon, GlobeIcon, PlugIcon, TerminalIcon } from 'lucide-react'
import { toast } from 'sonner'

import { EConfigLayer, EMcpTransportKind } from '@dltech/atlas-wire/web'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { CardRow } from '@dltech/atlas-ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Switch } from '@dltech/atlas-ui/components/switch'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { lastUsedOf } from '@/features/settings/data/shared/mcp-oauth'
import { rowOfServer, type McpRow } from '@/features/settings/data/shared/mcp-mapping'
import { runAction } from '@/features/settings/data/shared/run-action'
import { useMcpLayers } from '@/features/settings/data/shared/use-layers'
import { useMcpOauth, type McpOauth } from '@/features/settings/data/shared/use-mcp-oauth'
import type { McpOauthServer } from '@dltech/atlas-wire/web'
import {
  InheritedLayers,
  InheritedRow,
  OverriddenBadge,
} from '@/features/settings/parts/layers/inherited-layer-section'
import { McpOauthControl, McpSignOutItem } from '@/features/settings/parts/mcp-oauth-control'
import { McpOauthResult } from '@/features/settings/parts/mcp-oauth-result'
import {
  sectionHrefOf,
  useSettingsScope,
  type SettingsScope,
} from '@/features/settings/scope/settings-scope'
import { EQueryState } from '@/lib/use-cloud-query'

import { useScopedMcp, type ScopedMcp } from './data/use-scoped-mcp'
import { AddMcpServerDialog, type McpServerDraft } from './mcp-add-dialog'
import { McpPageSkeleton } from './project-skeletons'
import { SettingsCard, SettingsSection } from './settings-layout'

function ServerRow({
  server,
  onToggle,
  onRemove,
  auth,
}: {
  server: McpRow
  onToggle: (enabled: boolean) => void
  onRemove: () => void
  auth: McpOauth | null
}) {
  const TransportIcon = server.kind === EMcpTransportKind.Stdio ? TerminalIcon : GlobeIcon
  const connected = auth === null || !server.enabled ? undefined : auth.cloudServer(server.id)
  return (
    <CardRow className={cn('flex-row items-center', !server.enabled && 'opacity-60')}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <TransportIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{server.id}</span>
          {server.proxy === true ? <Badge variant="outline">Mac</Badge> : null}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />
            Not checked
          </span>
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{server.target}</span>
      </div>
      <McpOauthControl serverId={server.id} server={connected} auth={auth} />
      <Switch
        aria-label={`Enable ${server.id}`}
        checked={server.enabled}
        onCheckedChange={onToggle}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${server.id}`} />}
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <McpSignOutItem server={connected} auth={auth} />
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </CardRow>
  )
}

function RepoServerRow({
  server,
  auth,
  now,
}: {
  server: McpOauthServer
  auth: McpOauth
  now: number
}) {
  const remove = async () => {
    if (await auth.forget(server.id)) toast.success(`Removed ${server.name}`)
  }
  return (
    <CardRow className="flex-row items-center">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <GlobeIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{server.name}</span>
          <Badge variant="outline">From repo</Badge>
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{server.url}</span>
        <span className="text-xs text-muted-foreground">
          Last used {lastUsedOf({ lastSeenAt: server.lastSeenAt, now })}
        </span>
      </div>
      <McpOauthControl serverId={server.name} server={server} auth={auth} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${server.name}`} />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <McpSignOutItem server={server} auth={auth} />
          <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </CardRow>
  )
}

function ServersEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PlugIcon />
        </EmptyMedia>
        <EmptyTitle>No MCP servers yet</EmptyTitle>
        <EmptyDescription>
          Add one here to make it available to every thread in this scope.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function InheritedMcp({ scope }: { scope: SettingsScope }) {
  const layers = useMcpLayers(scope)
  if (layers.state !== EQueryState.Ready) return null
  const own = scope.kind === 'project' ? EConfigLayer.Project : EConfigLayer.Group
  return (
    <InheritedLayers
      layers={layers.data.filter((entry) => entry.layer !== own)}
      keyOf={(server) => server.name}
      editHrefOf={({ layer, owner }) => {
        if (layer === EConfigLayer.Personal) return '/settings/integrations'
        if (layer !== EConfigLayer.Group || owner.id === null) return null
        return sectionHrefOf({ scope: { kind: 'group', groupId: owner.id }, section: 'mcp' })
      }}
      renderRow={({ item }) => {
        const row = rowOfServer(item)
        return (
          <InheritedRow key={item.name} shadow={item.overriddenBy}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {row.kind === EMcpTransportKind.Stdio ? (
                <TerminalIcon className="size-4" />
              ) : (
                <GlobeIcon className="size-4" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-mono text-sm font-medium">{item.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{row.target}</span>
            </div>
            {item.overriddenBy === null ? null : <OverriddenBadge shadow={item.overriddenBy} />}
          </InheritedRow>
        )
      }}
    />
  )
}

function McpContent({
  scope,
  servers,
  mcp,
  auth,
}: {
  scope: SettingsScope
  servers: readonly McpRow[]
  mcp: ScopedMcp
  auth: McpOauth | null
}) {
  const handleAdd = (draft: McpServerDraft) =>
    void runAction({ work: () => mcp.add(draft), success: `Saved ${draft.id}` })
  const handleToggle = (args: { id: string; enabled: boolean }) =>
    void runAction({ work: () => mcp.toggle(args) })
  const handleRemove = (id: string) =>
    void runAction({ work: () => mcp.remove(id), success: `Removed ${id}` })
  const description =
    scope.kind === 'project'
      ? 'Project servers override your group and personal servers.'
      : 'Group servers reach every project in this group and override your personal servers.'
  return (
    <SettingsSection
      title="MCP"
      description={description}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/settings/integrations" />}
          >
            Personal MCP settings
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
          <AddMcpServerDialog onAdd={handleAdd} />
        </>
      }
    >
      {auth === null ? null : <McpOauthResult owner={auth.owner} reload={auth.reload} />}
      <SettingsCard>
        {servers.length === 0 ? (
          <ServersEmpty />
        ) : (
          servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              auth={auth}
              onToggle={(enabled) => handleToggle({ id: server.id, enabled })}
              onRemove={() => handleRemove(server.id)}
            />
          ))
        )}
      </SettingsCard>
      {auth === null || auth.repoServers.length === 0 ? null : (
        <SettingsSection
          title="From repo"
          description="Servers defined in a repository's .mcp.json. Removed automatically after 30 days unused."
        >
          <SettingsCard>
            {auth.repoServers.map((server) => (
              <RepoServerRow key={server.id} server={server} auth={auth} now={auth.now} />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsSection>
  )
}

function McpScopePage({ scope, auth }: { scope: SettingsScope; auth: McpOauth | null }) {
  const mcp = useScopedMcp(scope)
  return (
    <>
      <InheritedMcp scope={scope} />
      <QueryGate query={mcp.query} label="MCP servers" skeleton={<McpPageSkeleton />}>
        {(rows) => <McpContent scope={scope} servers={rows} mcp={mcp} auth={auth} />}
      </QueryGate>
    </>
  )
}

function ScopedMcpPage({ scope }: { scope: SettingsScope }) {
  const auth = useMcpOauth(
    scope.kind === 'group'
      ? { kind: 'group', groupId: scope.groupId }
      : { kind: 'project', projectId: scope.projectId },
  )
  return <McpScopePage scope={scope} auth={auth} />
}

export function McpPage() {
  return <ScopedMcpPage scope={useSettingsScope()} />
}
