'use client'

import { Button } from '@dltech/atlas-ui/components/button'

import { desktopSignOut } from '@/features/desktop/desktop-auth'
import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { signOut } from '@/lib/auth-api'

const SIGN_IN_PATH = '/sign-in'

export function WhitelistWall() {
  const handleSignOut = async () => {
    const leave = isDesktopHost(window) ? desktopSignOut : signOut
    await leave().catch(() => undefined)
    window.location.assign(SIGN_IN_PATH)
  }
  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
        You&apos;re on the list
      </h1>
      <p className="text-sm text-muted-foreground text-pretty">
        Atlas Cloud is invite-only for now. Dennis will switch access on for your account soon.
      </p>
      <Button variant="outline" onClick={() => void handleSignOut()}>
        Sign out
      </Button>
    </div>
  )
}
