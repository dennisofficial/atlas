'use client'

import { CircleCheckIcon, LogInIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { DropdownMenuItem } from '@dltech/atlas-ui/components/dropdown-menu'

import { EMcpAuthState } from '../data/shared/mcp-oauth'
import type { McpOauth } from '../data/shared/use-mcp-oauth'

export function McpOauthControl({
  serverId,
  signInUrl,
  auth,
}: {
  serverId: string
  signInUrl: string | undefined
  auth: McpOauth
}) {
  const state = auth.stateOf(signInUrl)
  if (signInUrl === undefined || state === undefined) return null
  if (state === EMcpAuthState.SignedIn) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheckIcon aria-hidden className="size-3.5" />
        Signed in
      </span>
    )
  }
  const again = state === EMcpAuthState.SignInAgain
  return (
    <Button
      variant={again ? 'default' : 'outline'}
      size="sm"
      disabled={auth.isBusy(signInUrl)}
      aria-label={`${again ? 'Sign in again to' : 'Sign in to'} ${serverId}`}
      onClick={() => auth.signIn(signInUrl)}
    >
      <LogInIcon data-icon="inline-start" />
      {again ? 'Sign in again' : 'Sign in'}
    </Button>
  )
}

export function McpSignOutItem({
  signInUrl,
  auth,
}: {
  signInUrl: string | undefined
  auth: McpOauth
}) {
  if (signInUrl === undefined || auth.stateOf(signInUrl) !== EMcpAuthState.SignedIn) return null
  return <DropdownMenuItem onClick={() => auth.signOut(signInUrl)}>Sign out</DropdownMenuItem>
}
