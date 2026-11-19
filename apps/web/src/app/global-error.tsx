'use client'

import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { captureException } from '@/lib/analytics/analytics'

import './globals.css'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-3 p-6">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              Atlas hit an unexpected error. Try again, and if it keeps failing, reload the page.
            </span>
          </div>
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        </div>
      </body>
    </html>
  )
}
