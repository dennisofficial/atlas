'use client'

import { CircleCheckIcon, LogInIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { DropdownMenuItem } from '@dltech/atlas-ui/components/dropdown-menu'

import type { McpOauthServer } from '@dltech/atlas-wire/web'

import { EMcpAuthState } from '../data/shared/mcp-oauth'
import type { McpOauth } from '../data/shared/use-mcp-oauth'

export function McpOauthControl({
  serverId,
  server,
  auth,
}: {
  serverId: string
  server: McpOauthServer | undefined
  auth: McpOauth
}) {
  if (server === undefined) return null
  const state = auth.stateOf(server)
  if (state === EMcpAuthState.SignedIn) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheckIcon aria-hidden className="size-3.5" />
        Signed in
      </span>
    )
  }
  const again = state === EMcpAuthState.SignInAgain
  const id = server?.id
  return (
    <Button
      variant={again ? 'default' : 'outline'}
      size="sm"
      disabled={id === undefined || auth.isBusy(id)}
      aria-label={`${again ? 'Sign in again to' : 'Sign in to'} ${serverId}`}
      onClick={() => id !== undefined && auth.signIn(id)}
    >
      <LogInIcon data-icon="inline-start" />
      {again ? 'Sign in again' : 'Sign in'}
    </Button>
  )
}

export function McpSignOutItem({
  server,
  auth,
}: {
  server: McpOauthServer | undefined
  auth: McpOauth
}) {
  if (server === undefined || auth.stateOf(server) !== EMcpAuthState.SignedIn) return null
  return <DropdownMenuItem onClick={() => auth.signOut(server.id)}>Sign out</DropdownMenuItem>
}
