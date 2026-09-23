'use client'

import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { sessionUserPresent } from '../lib/auth-api'

export default function HomePage() {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let cancelled = false
    void sessionUserPresent()
      .then((present) => {
        if (!cancelled) setSignedIn(present)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-sm">
      <Card title="Atlas Cloud" subtitle="Account and device sign-in">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-meta">
            This service hosts Atlas Cloud sign-in. If a device sent you here, follow the link it
            opened instead of this one.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="primary" fullWidth>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild variant="outline" fullWidth>
              <Link href="/sign-up">Create an account</Link>
            </Button>
          </div>
          {signedIn ? (
            <Button asChild variant="secondary" fullWidth>
              <Link href="/factory">Factory setup</Link>
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
