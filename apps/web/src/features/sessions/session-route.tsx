'use client'

import { usePathname } from 'next/navigation'

import { routeIdAfter } from '@/lib/route-id'

import { SessionView } from './session-view'

export function SessionRoute() {
  const sessionId = routeIdAfter({ pathname: usePathname(), segment: 'sessions' })
  return <SessionView key={sessionId} sessionId={sessionId} />
}
