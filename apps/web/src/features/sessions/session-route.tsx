'use client'

import { useRouteParam } from '@/lib/route-param'

import { SessionView } from './session-view'

export function SessionRoute() {
  const sessionId = useRouteParam('sessionId')
  return <SessionView key={sessionId} sessionId={sessionId} />
}
