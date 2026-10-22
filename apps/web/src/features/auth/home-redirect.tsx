'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { sessionUserPresent } from '@/lib/auth-api'

import { PageSpinner } from './page-spinner'

export function HomeRedirect() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const route = async () => {
      const present = await sessionUserPresent().catch(() => false)
      if (!cancelled) router.replace(present ? '/threads/new' : '/sign-in')
    }
    void route()
    return () => {
      cancelled = true
    }
  }, [router])

  return <PageSpinner label="Loading…" />
}
