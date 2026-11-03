'use client'

import { EllipsisIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

import type { McpOauthServer } from '@dltech/atlas-wire/web'

import { lastUsedOf } from '../data/shared/mcp-oauth'
import type { McpOauth } from '../data/shared/use-mcp-oauth'
import { Mono, SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { McpOauthControl, McpSignOutItem } from './mcp-oauth-control'

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
    <SettingsRow
      title={
        <>
          <Mono className="text-sm">{server.name}</Mono>
          <Badge variant="outline">From repo</Badge>
        </>
      }
      description={
        <>
          <Mono className="block truncate text-muted-foreground">{server.url}</Mono>
          <span className="text-xs text-muted-foreground">
            Last used {lastUsedOf({ lastSeenAt: server.lastSeenAt, now })}
          </span>
        </>
      }
      control={
        <>
          <McpOauthControl serverId={server.name} server={server} auth={auth} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={`${server.name} actions`} />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <McpSignOutItem server={server} auth={auth} />
              <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  )
}

export function McpRepoServers({ auth }: { auth: McpOauth }) {
  if (auth.repoServers.length === 0) return null
  return (
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
  )
}
