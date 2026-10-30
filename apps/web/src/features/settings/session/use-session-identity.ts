'use client'

import { type SessionUser } from '@/lib/auth-api'
import { EQueryState } from '@/lib/use-cloud-query'
import { useSessionQuery } from '@/lib/use-session-query'

export function useSessionUser(): { user: SessionUser | null; ready: boolean } {
  const query = useSessionQuery()
  return {
    user: query.state === EQueryState.Ready ? query.data : null,
    ready: query.state !== EQueryState.Loading,
  }
}
