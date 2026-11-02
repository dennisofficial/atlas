import { Suspense } from 'react'

import { DeviceAuthorizer } from '@/features/auth/device-authorizer'
import { DeviceConfirmSkeleton } from '@/features/auth/auth-flow-skeletons'

export default function Page() {
  return (
    <Suspense fallback={<DeviceConfirmSkeleton />}>
      <DeviceAuthorizer />
    </Suspense>
  )
}
