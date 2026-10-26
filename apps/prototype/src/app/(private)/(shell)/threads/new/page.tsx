import { Suspense } from 'react'

import { NewThreadRoute } from '@/features/threads/new-thread-route'

export default function NewThreadPage() {
  return (
    <Suspense>
      <NewThreadRoute />
    </Suspense>
  )
}
