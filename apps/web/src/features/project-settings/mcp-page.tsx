'use client'

import Link from 'next/link'
import { ArrowUpRightIcon, EllipsisIcon, GlobeIcon, PlugIcon, TerminalIcon } from 'lucide-react'

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

import { EMcpTransportKind } from '@dltech/atlas-wire/web'

import type { McpRow } from '@/features/settings/data/shared/mcp-mapping'
import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { runAction } from '@/features/settings/data/shared/run-action'

import { useProjectContext } from './data/project-context'
import { useProjectMcp } from './data/use-project-mcp'
import { AddMcpServerDialog, type McpServerDraft } from './mcp-add-dialog'
import { SettingsCard, SettingsSection } from './settings-layout'

function ServerRow({
  server,
  onToggle,
  onRemove,
}: {
  server: McpRow
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}) {
  const TransportIcon = server.kind === EMcpTransportKind.Stdio ? TerminalIcon : GlobeIcon
  return (
    <CardRow className={cn('flex-row items-center', !server.enabled && 'opacity-60')}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <TransportIcon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{server.id}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />
            Not checked
          </span>
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{server.target}</span>
      </div>
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
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
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
        <EmptyTitle>No project MCP servers</EmptyTitle>
        <EmptyDescription>
          Add one here to make it available to every thread in this project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function McpContent({ servers }: { servers: McpRow[] }) {
  const { projectId } = useProjectContext()
  const mcp = useProjectMcp(projectId)

  const handleAdd = (draft: McpServerDraft) =>
    void runAction({
      work: () => mcp.add(draft),
      success: `Saved ${draft.id}`,
    })
  const handleToggle = (args: { id: string; enabled: boolean }) =>
    void runAction({ work: () => mcp.toggle(args) })
  const handleRemove = (id: string) =>
    void runAction({ work: () => mcp.remove(id), success: `Removed ${id}` })

  return (
    <SettingsSection
      title="MCP"
      description="Project servers override your personal servers."
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
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
      <SettingsCard>
        {servers.length === 0 ? (
          <ServersEmpty />
        ) : (
          servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              onToggle={(enabled) => handleToggle({ id: server.id, enabled })}
              onRemove={() => handleRemove(server.id)}
            />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  )
}

export function McpPage() {
  const { projectId } = useProjectContext()
  const { query } = useProjectMcp(projectId)
  return (
    <QueryGate query={query} label="project MCP servers">
      {(servers) => <McpContent servers={servers} />}
    </QueryGate>
  )
}
