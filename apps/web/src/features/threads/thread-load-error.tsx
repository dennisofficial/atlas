import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'

import { CloudApiError } from '@/lib/cloud-api'

export function ThreadLoadError({ error }: { error: Error }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this thread</AlertTitle>
        <AlertDescription>
          {error instanceof CloudApiError ? error.message : String(error)}
        </AlertDescription>
      </Alert>
    </div>
  )
}
