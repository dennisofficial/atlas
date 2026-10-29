'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { rememberReturnPath } from './return-path'

export function RememberReturnPath() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    rememberReturnPath(search === '' ? pathname : `${pathname}?${search}`)
  }, [pathname, search])
  return null
}
