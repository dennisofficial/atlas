import { Suspense } from 'react'

import { ArtifactsIndexRoute } from '@/features/artifacts/artifacts-index-route'

export default function ArtifactsPage() {
  return (
    <Suspense>
      <ArtifactsIndexRoute />
    </Suspense>
  )
}
