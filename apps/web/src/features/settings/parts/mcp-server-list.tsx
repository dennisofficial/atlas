'use client'

import { EllipsisIcon, PlugIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
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

import { McpOauthControl, McpSignOutItem } from './mcp-oauth-control'
import type { McpOauth } from '../data/shared/use-mcp-oauth'
import type { McpServer } from '../fixtures/settings-mcp'
import { Mono, SettingsCard, SettingsRow } from '../settings-layout'

export function McpServerList({
  servers,
  onToggle,
  onRemove,
  auth,
}: {
  servers: McpServer[]
  onToggle: (change: { id: string; enabled: boolean }) => void
  onRemove: (id: string) => void
  auth: McpOauth
}) {
  if (servers.length === 0) {
    return (
      <Empty variant="outline">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlugIcon />
          </EmptyMedia>
          <EmptyTitle>No MCP servers configured</EmptyTitle>
          <EmptyDescription>Add a server to give threads extra tools.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <SettingsCard>
      {servers.map((server) => (
        <SettingsRow
          key={server.id}
          title={
            <>
              <Mono className="text-sm">{server.id}</Mono>
              <Badge variant="outline">{server.transport}</Badge>
            </>
          }
          description={
            <Mono className="block truncate text-muted-foreground">{server.target}</Mono>
          }
          control={
            <>
              <McpOauthControl
                serverId={server.id}
                signInUrl={server.enabled ? server.signInUrl : undefined}
                auth={auth}
              />
              <Switch
                size="sm"
                aria-label={`Enable ${server.id}`}
                checked={server.enabled}
                onCheckedChange={(enabled) => onToggle({ id: server.id, enabled })}
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label={`${server.id} actions`} />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <McpSignOutItem signInUrl={server.signInUrl} auth={auth} />
                  <DropdownMenuItem variant="destructive" onClick={() => onRemove(server.id)}>
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      ))}
    </SettingsCard>
  )
}
