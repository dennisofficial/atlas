'use client'

import { useEffect, useState } from 'react'

import { sessionUser, type SessionUser } from '@/lib/auth-api'

export function useSessionUser(): { user: SessionUser | null; ready: boolean } {
  const [state, setState] = useState<{ user: SessionUser | null; ready: boolean }>({
    user: null,
    ready: false,
  })
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const user = await sessionUser().catch(() => null)
      if (!cancelled) setState({ user, ready: true })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
