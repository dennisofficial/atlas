'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { sessionUserPresent } from '@/lib/auth-api'

enum EGateState {
  Checking = 'checking',
  Allowed = 'allowed',
  Redirecting = 'redirecting',
}

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState(EGateState.Checking)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const present = await sessionUserPresent().catch(() => false)
      if (cancelled) return
      if (present) {
        setState(EGateState.Allowed)
        return
      }
      setState(EGateState.Redirecting)
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`)
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (state === EGateState.Allowed) return children
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Spinner />
      <span>{state === EGateState.Redirecting ? 'Redirecting to sign in…' : 'Loading…'}</span>
    </div>
  )
}
