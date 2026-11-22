import { Suspense } from 'react'

import { ArtifactDetailView } from '@/features/artifacts/artifact-detail-view'

export default function ArtifactPage() {
  return (
    <Suspense>
      <ArtifactDetailView />
    </Suspense>
  )
}
