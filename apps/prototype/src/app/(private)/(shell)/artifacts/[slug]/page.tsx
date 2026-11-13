import { Suspense } from 'react'

import { ArtifactsDetailRoute } from '@/features/artifacts/artifacts-detail-route'

export default function ArtifactPage() {
  return (
    <Suspense>
      <ArtifactsDetailRoute />
    </Suspense>
  )
}
