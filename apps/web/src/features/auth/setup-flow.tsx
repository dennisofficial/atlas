'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { sessionUserPresent } from '@/lib/auth-api'

import { PageSpinner } from './page-spinner'
import { SetupDone } from './setup-done'

const SIGN_IN_FOR_SETUP = '/sign-in?next=%2Fsetup'

export function SetupFlow() {
  const router = useRouter()
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      if (!(await sessionUserPresent().catch(() => false))) {
        router.replace(SIGN_IN_FOR_SETUP)
        return
      }
      if (!cancelled) setSignedIn(true)
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [router])

  if (!signedIn) return <PageSpinner label="Loading…" />
  return <SetupDone />
}
