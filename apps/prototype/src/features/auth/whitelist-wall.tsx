import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'

import { AUTH_PATHS } from './auth-paths'

export function WhitelistWall() {
  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
        You&apos;re on the list
      </h1>
      <p className="text-sm text-muted-foreground text-pretty">
        Atlas Cloud is invite-only for now. Dennis will switch access on for your account soon.
      </p>
      <Button variant="outline" render={<Link href={AUTH_PATHS.signIn} />}>
        Sign out
      </Button>
    </div>
  )
}
