'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { initAnalytics, isAnalyticsEnabled } from './analytics'
import { recordPageLoad } from './app-load'
import { markRouteCommitted } from './route-navigation-runtime'

function navigationEntry(): PerformanceNavigationTiming | undefined {
  return performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
}

export function AnalyticsProvider() {
  const pathname = usePathname()
  useEffect(() => {
    markRouteCommitted(pathname)
  }, [pathname])

  useEffect(() => {
    if (!isAnalyticsEnabled()) return undefined
    initAnalytics()
    const entry = navigationEntry()
    if (entry !== undefined && entry.loadEventEnd > 0) {
      recordPageLoad(entry)
      return undefined
    }
    const onLoad = () => {
      const loaded = navigationEntry()
      if (loaded !== undefined) recordPageLoad(loaded)
    }
    window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])
  return null
}
