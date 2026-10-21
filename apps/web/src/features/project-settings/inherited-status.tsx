'use client'

import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { LoadFailed } from '@/features/settings/data/workspace/query-gate'
import { EQueryState } from '@/lib/use-cloud-query'

import type { InheritedView } from './data/inherited-secrets'

export function InheritedStatus({ inherited }: { inherited: InheritedView }) {
  if (inherited.state === EQueryState.Ready) return null
  if (inherited.state === EQueryState.Failed) {
    return (
      <LoadFailed
        label="workspace values"
        message={`${inherited.message} Showing project values only; inherited and overridden workspace values are hidden.`}
        onRetry={inherited.retry}
      />
    )
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      Loading workspace values…
    </p>
  )
}
