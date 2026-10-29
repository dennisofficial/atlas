import { Suspense } from 'react'

import { HomeRoute } from '@/features/shell/home-route'

export default function HomePage() {
  return (
    <Suspense>
      <HomeRoute />
    </Suspense>
  )
}
