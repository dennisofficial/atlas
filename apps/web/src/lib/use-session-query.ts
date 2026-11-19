'use client'

import { sessionAccess, type SessionAccess } from './auth-api'
import { useCloudQuery, type CloudQuery } from './use-cloud-query'

export const SESSION_QUERY_KEY = 'session-user'

export const useSessionQuery = (): CloudQuery<SessionAccess | null> =>
  useCloudQuery({ key: SESSION_QUERY_KEY, load: sessionAccess, retry: 0 })
