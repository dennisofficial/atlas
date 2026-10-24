import type { ReactNode } from 'react'

import { Toaster } from '@dltech/atlas-ui/components/sonner'

import { SignInRedirect } from '@/features/auth/sign-in-redirect'
import { readServerSession } from '@/lib/server-session'

export default async function PrivateLayout({ children }: { children: ReactNode }) {
  const signedIn = await readServerSession()
  if (!signedIn) return <SignInRedirect />
  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
