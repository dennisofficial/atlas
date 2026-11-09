'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { ESettingsPage, hrefOfPage } from './settings-nav'

export function SettingsIndexRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace(hrefOfPage(ESettingsPage.Account))
  }, [router])

  return null
}
