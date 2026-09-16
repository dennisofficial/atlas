import { useCallback, useRef } from 'react'

import type { CloudLoginTicket, CloudService, UrlOpener } from '@dltech/atlas-harness'
import { ECloudLoginPoll, pollCloudLogin } from '@dltech/atlas-harness'

import {
  askForCloudCode,
  backToList,
  EAccountsView,
  failed,
  type AccountsState,
} from '../ui/accounts-model'

export type CloudLoginControl = {
  begin: (current: AccountsState) => void
  stop: () => void
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

const signedInNotice = (args: { email: string | null; imported: number }): string => {
  const whom = args.email === null ? '' : ` as ${args.email}`
  const imported =
    args.imported > 0 ? ` Imported ${args.imported} accounts from this machine.` : ''
  return `Signed in to Atlas Cloud${whom}.${imported}`
}

/**
 * The device code's clock keeps ticking while the drawer is open, so the poll re-reads the held
 * state rather than trusting a closure — an escape or a re-render mid-poll must stop it. Same
 * invariant as the provider device flow in use-accounts.
 */
export function useCloudLogin(args: {
  cloud: CloudService
  openUrl: UrlOpener
  held: { current: AccountsState | null }
  put: (next: AccountsState | null) => void
  refresh: (change?: (state: AccountsState) => AccountsState) => void
}): CloudLoginControl {
  const { cloud, openUrl, held, put, refresh } = args
  const login = useRef<{ ticket: CloudLoginTicket; deadline: number; intervalMs: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    login.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const failOpen = useCallback(
    (error: unknown) => {
      stop()
      const now = held.current
      if (now !== null) put(failed({ state: now, reason: reasonOf(error) }))
    },
    [held, put, stop],
  )

  const poll = useCallback(() => {
    const open = login.current
    const current = held.current
    if (open === null || current === null || current.view !== EAccountsView.CloudDevice) return

    if (Date.now() > open.deadline) {
      stop()
      put(failed({ state: current, reason: 'that code expired.' }))
      return
    }

    void pollCloudLogin({ ticket: open.ticket })
      .then((result) => {
        const now = held.current
        if (now === null || now.view !== EAccountsView.CloudDevice) return

        if (result.status === ECloudLoginPoll.Approved) {
          const { ticket } = open
          stop()
          void cloud
            .finishLogin({ ticket, token: result.token })
            .then((finished) => {
              refresh((next) => ({
                ...backToList(next),
                notice: signedInNotice({
                  email: finished.session.email,
                  imported: finished.imported,
                }),
              }))
            })
            .catch(failOpen)
          return
        }

        if (result.status === ECloudLoginPoll.Pending) {
          timer.current = setTimeout(poll, open.intervalMs)
          return
        }

        if (result.status === ECloudLoginPoll.SlowDown) {
          open.intervalMs += 5000
          timer.current = setTimeout(poll, open.intervalMs)
          return
        }

        stop()
        const reason =
          result.status === ECloudLoginPoll.Denied
            ? 'that sign-in was refused.'
            : 'that code expired.'
        put(failed({ state: now, reason }))
      })
      .catch(failOpen)
  }, [cloud, held, put, refresh, stop, failOpen])

  const begin = useCallback(
    (current: AccountsState) => {
      put(askForCloudCode({ state: current }))

      void cloud
        .beginLogin()
        .then((ticket) => {
          const now = held.current
          if (now === null || now.view !== EAccountsView.CloudDevice) return

          const intervalMs = Math.max(ticket.intervalMs, 3000)
          login.current = { ticket, deadline: Date.now() + ticket.expiresInMs, intervalMs }
          put(
            askForCloudCode({
              state: now,
              prompt: { url: ticket.verificationUrl, userCode: ticket.userCode },
            }),
          )
          openUrl(ticket.verificationUrl)
          timer.current = setTimeout(poll, intervalMs)
        })
        .catch((error: unknown) => {
          const now = held.current
          if (now !== null) put(failed({ state: now, reason: reasonOf(error) }))
        })
    },
    [cloud, held, openUrl, poll, put],
  )

  return { begin, stop }
}
