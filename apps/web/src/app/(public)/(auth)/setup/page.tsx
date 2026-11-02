import { Suspense } from 'react'

import { SetupFlow } from '@/features/auth/setup-flow'
import { SetupSkeleton } from '@/features/auth/auth-flow-skeletons'

export default function Page() {
  return (
    <Suspense fallback={<SetupSkeleton />}>
      <SetupFlow />
    </Suspense>
  )
}
