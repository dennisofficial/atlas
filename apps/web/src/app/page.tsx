'use client'

import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import Link from 'next/link'

export default function HomePage() {
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
        </div>
      </Card>
    </div>
  )
}
