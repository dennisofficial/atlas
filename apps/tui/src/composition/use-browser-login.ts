import { useCallback, useMemo, useRef, type MutableRefObject } from 'react'

import type { EAuthProvider } from '@dltech/atlas-core'
import type { AccountsService, BrowserTicket, UrlOpener } from '@dltech/atlas-harness'

import {
  askForBrowser,
  backToList,
  EAccountsView,
  failed,
  type AccountsState,
} from '../ui/accounts-model'

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export type BrowserLogin = {
  begin: (args: { state: AccountsState; provider: EAuthProvider }) => void
  cancel: () => void
}

/**
 * The browser login resolves long after the operator may have escaped, so every continuation
 * re-reads the held state and checks its attempt number before touching the drawer.
 */
export function useBrowserLogin(args: {
  accounts: AccountsService
  openUrl: UrlOpener
  held: MutableRefObject<AccountsState | null>
  put: (next: AccountsState | null) => void
  refresh: (change: (state: AccountsState) => AccountsState) => void
}): BrowserLogin {
  const { accounts, openUrl, held, put, refresh } = args
  const ticket = useRef<BrowserTicket | null>(null)
  const attempt = useRef(0)

  const cancel = useCallback(() => {
    attempt.current += 1
    void ticket.current?.cancel()
    ticket.current = null
  }, [])

  const watching = useCallback(
    (number: number): AccountsState | null => {
      const now = held.current
      if (attempt.current !== number || now === null) return null

      return now.view === EAccountsView.BrowserCode ? now : null
    },
    [held],
  )

  const begin = useCallback(
    (start: { state: AccountsState; provider: EAuthProvider }) => {
      attempt.current += 1
      const number = attempt.current
      const { provider } = start

      put(askForBrowser({ state: start.state, prompt: { provider, url: '' } }))

      void accounts
        .beginBrowser(provider)
        .then((begun) => {
          const now = watching(number)
          if (now === null) {
            begun.login.catch(() => undefined)
            void begun.cancel()
            return undefined
          }

          ticket.current = begun
          put(askForBrowser({ state: now, prompt: { provider: begun.provider, url: begun.url } }))
          openUrl(begun.url)

          return begun.login.then((account) => {
            if (watching(number) === null) return

            ticket.current = null
            refresh((next) => ({
              ...backToList(next),
              notice: `Signed in as ${account.label}.`,
            }))
          })
        })
        .catch((error: unknown) => {
          const now = watching(number)
          if (now === null) return

          ticket.current = null
          put(failed({ state: now, reason: reasonOf(error) }))
        })
    },
    [accounts, openUrl, put, refresh, watching],
  )

  return useMemo(() => ({ begin, cancel }), [begin, cancel])
}
