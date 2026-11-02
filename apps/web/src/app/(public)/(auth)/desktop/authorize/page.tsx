import { Suspense } from 'react'

import { DesktopAuthorizer } from '@/features/auth/desktop-authorizer'
import { PageSpinner } from '@/features/auth/page-spinner'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Opening Atlas…" />}>
      <DesktopAuthorizer />
    </Suspense>
  )
}
