'use client'

import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'

import { useSessionUser } from '@/features/settings/session/use-session-identity'

export function HomeActions() {
  const { user, ready } = useSessionUser()
  if (!ready) return <div className="h-[4.75rem]" aria-hidden />
  if (user !== null) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="lg" nativeButton={false} render={<Link href="/threads/new" />}>
          New thread
        </Button>
        <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/settings" />}>
          Open settings
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" nativeButton={false} render={<Link href="/sign-in" />}>
        Sign in
      </Button>
      <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/sign-up" />}>
        Create an account
      </Button>
    </div>
  )
}
