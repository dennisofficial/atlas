import { Suspense } from 'react'

import { RoutinesIndexRoute } from '@/features/routines/routines-index-route'

export default function RoutinesPage() {
  return (
    <Suspense>
      <RoutinesIndexRoute />
    </Suspense>
  )
}
