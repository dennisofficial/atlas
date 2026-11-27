import { type IAuthAccountApi, createAuthAccountApi } from '@dltech/atlas-client/settings'
import { useMemo } from 'react'

import { useAuth } from '../../auth/auth-provider'
import { apiOrigin } from '../../config'

export const useAccountApi = (): IAuthAccountApi | undefined => {
  const { token } = useAuth()
  return useMemo(
    () => (token === undefined ? undefined : createAuthAccountApi({ baseUrl: apiOrigin, token })),
    [token],
  )
}
