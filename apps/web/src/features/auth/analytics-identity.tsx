'use client'

import { useEffect } from 'react'

import { identifyUser } from '@/lib/analytics/analytics'
import { EQueryState } from '@/lib/use-cloud-query'
import { useSessionQuery } from '@/lib/use-session-query'

export function AnalyticsIdentity() {
  const query = useSessionQuery()
  const userId = query.data?.userId
  const email = query.data?.email
  useEffect(() => {
    if (query.state !== EQueryState.Ready || userId === undefined) return
    identifyUser(userId, { email })
  }, [query.state, userId, email])
  return null
}
