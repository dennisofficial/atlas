import type { ReactNode } from 'react'

import { Toaster } from '@dltech/atlas-ui/components/sonner'

import { AuthGate } from '@/features/auth/auth-gate'

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      {children}
      <Toaster />
    </AuthGate>
  )
}
