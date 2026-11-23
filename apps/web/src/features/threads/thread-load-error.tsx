import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { readingClasses } from '@dltech/atlas-ui/tokens'

import { CloudApiError } from '@/lib/cloud-api'

export function ThreadLoadError({ error }: { error: Error }) {
  return (
    <div className={`mx-auto w-full ${readingClasses.measure} px-4 pt-4`}>
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this thread</AlertTitle>
        <AlertDescription>
          {error instanceof CloudApiError ? error.message : String(error)}
        </AlertDescription>
      </Alert>
    </div>
  )
}
