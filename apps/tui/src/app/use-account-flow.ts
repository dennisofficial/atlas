import { useCallback, useRef, useState } from 'react'

import {
  ACCOUNT_FILE_VERSION,
  deleteAccount,
  withPreferences,
  writeAccount,
  type AccountFile,
} from './account/account-file'
import { fetchSessionEmail, signOutSession } from './account/session-email'
import { useDeviceSignIn } from './account/use-device-sign-in'
import { EScreen, screenOfAccount, screenOnAuthLost, type ScreenState } from './app-screen'
import type { AuthRefusal } from './session-client'

export function useAccountFlow(args: {
  accountPath: string
  apiUrl: string
  initialAccount: AccountFile | null
  openUrl: (url: string) => void
  fetchFn?: typeof fetch | undefined
  onScreen: (screen: ScreenState) => void
}) {
  const [account, setAccount] = useState<AccountFile | null>(args.initialAccount)
  const held = useRef<AccountFile | null>(account)
  held.current = account
  const { onScreen } = args

  const handleAuthLost = useCallback(
    (status: AuthRefusal) => {
      if (status === 403) {
        onScreen(screenOnAuthLost({ status, email: held.current?.email ?? null }))
        return
      }
      deleteAccount({ path: args.accountPath })
      setAccount(null)
      onScreen(screenOnAuthLost({ status, email: null }))
    },
    [args.accountPath, onScreen],
  )

  const handleApproved = useCallback(
    async (result: { token: string }) => {
      const email = await fetchSessionEmail({
        apiUrl: args.apiUrl,
        token: result.token,
        fetchFn: args.fetchFn,
      })
      const next: AccountFile = {
        version: ACCOUNT_FILE_VERSION,
        apiUrl: args.apiUrl,
        email,
        token: result.token,
        preferences: {},
      }
      writeAccount({ path: args.accountPath, account: next })
      setAccount(next)
      onScreen(screenOfAccount({ account: next }))
    },
    [args.accountPath, args.apiUrl, args.fetchFn, onScreen],
  )

  const signIn = useDeviceSignIn({
    apiUrl: args.apiUrl,
    openUrl: args.openUrl,
    fetchFn: args.fetchFn,
    onApproved: handleApproved,
  })

  const handlePreferences = useCallback(
    (preferences: Record<string, unknown>) => {
      const open = held.current
      if (open === null) return
      const next = withPreferences({ account: open, preferences })
      held.current = next
      writeAccount({ path: args.accountPath, account: next })
      setAccount(next)
    },
    [args.accountPath],
  )

  const handleSignOut = useCallback(async () => {
    const open = held.current
    if (open !== null)
      await signOutSession({ apiUrl: open.apiUrl, token: open.token, fetchFn: args.fetchFn })
    deleteAccount({ path: args.accountPath })
    setAccount(null)
    onScreen({ screen: EScreen.SignIn, reason: null })
  }, [args.accountPath, args.fetchFn, onScreen])

  return { account, setAccount, handleAuthLost, handlePreferences, signIn, handleSignOut }
}
