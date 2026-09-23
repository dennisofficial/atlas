import { Suspense } from 'react'

import { FactoryDashboard } from './factory-dashboard'

export default function FactoryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-meta">Loading…</p>}>
      <FactoryDashboard />
    </Suspense>
  )
}
