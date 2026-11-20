'use client'

import { AlertCircle } from 'lucide-react'

import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

import { ErrorDetails } from '@/features/errors/error-details'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-3 p-6">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          Something went wrong loading this page. Try again, and if it keeps failing, reload Atlas.
        </AlertDescription>
      </Alert>
      <ErrorDetails error={error} />
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
