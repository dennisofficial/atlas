import { Suspense } from 'react'

import { DeviceAuthorizer } from './device-authorizer'

export default function DevicePage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <Suspense fallback={<p className="text-sm text-meta">Loading…</p>}>
        <DeviceAuthorizer />
      </Suspense>
    </div>
  )
}
