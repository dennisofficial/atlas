import type { ReactNode } from 'react'

import { Toaster } from '@dltech/atlas-ui/components/sonner'

import { SessionGate } from '@/features/auth/session-gate'
import { QueryProvider } from '@/lib/query-provider'

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster />
    </QueryProvider>
  )
}
