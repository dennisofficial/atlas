import { type ReactNode, Suspense } from 'react'

import { AppShell } from '@/features/shell/app-shell'

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  )
}
