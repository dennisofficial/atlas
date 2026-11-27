'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { publishReturn, watchReturns } from './return-channel'
import { returnActionOf } from './return-action'

const hrefOf = (search: string): string => {
  const { origin, pathname } = window.location
  return search === '' ? `${origin}${pathname}` : `${origin}${pathname}?${search}`
}

export const useBrowserReturnReader = (): void => {
  const search = useSearchParams().toString()
  const handled = useRef<string | null>(null)

  useEffect(() => watchReturns(), [])

  useEffect(() => {
    if (handled.current === search) return
    const action = returnActionOf({ href: hrefOf(search), windowName: window.name })
    if (action === undefined) return
    handled.current = search
    publishReturn(action.returned)
    window.history.replaceState(window.history.state, '', action.cleanHref)
    if (action.close) window.close()
  }, [search])
}
