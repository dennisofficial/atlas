'use client'

import { sessionUser, type SessionUser } from './auth-api'
import { useCloudQuery, type CloudQuery } from './use-cloud-query'

export const SESSION_QUERY_KEY = 'session-user'

export const useSessionQuery = (): CloudQuery<SessionUser | null> =>
  useCloudQuery({ key: SESSION_QUERY_KEY, load: sessionUser, retry: 0 })
