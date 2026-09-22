import { Suspense } from 'react'

import { DeviceAuthorizer } from './device-authorizer'

export default function DevicePage() {
  return (
    <Suspense fallback={<p className="text-sm text-meta">Loading…</p>}>
      <DeviceAuthorizer />
    </Suspense>
  )
}
