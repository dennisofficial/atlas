import { Suspense } from 'react'

import { ArtifactsView } from '@/features/artifacts/artifacts-view'

export default function ArtifactsPage() {
  return (
    <Suspense>
      <ArtifactsView />
    </Suspense>
  )
}
