import { Suspense } from 'react'

import { RoutineDetailRoute } from '@/features/routines/routines-detail-route'

export default function RoutinePage() {
  return (
    <Suspense>
      <RoutineDetailRoute />
    </Suspense>
  )
}
