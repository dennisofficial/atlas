import type { ReactNode } from 'react'

import { Toaster } from '@dltech/atlas-ui/components/sonner'

import { SessionGate } from '@/features/auth/session-gate'

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionGate>{children}</SessionGate>
      <Toaster />
    </>
  )
}
