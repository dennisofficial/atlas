import { useCallback, useRef, useState } from 'react'

import type { CloudLoginTicket, CloudService, UrlOpener } from '@dltech/atlas-harness'
import { ECloudLoginPoll, pollCloudLogin } from '@dltech/atlas-harness'

import {
  askingLogin,
  ESettingsLogin,
  failedLogin,
  finishingLogin,
  idleLogin,
  promptingLogin,
  signedInLogin,
  type SettingsLoginState,
} from '../ui/settings-login-model'

export type SettingsCloudLoginControl = {
  state: SettingsLoginState
  begin: () => void
  stop: () => void
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export const signedInNotice = (args: { email: string | null; imported: number }): string => {
  const whom = args.email === null ? '' : ` as ${args.email}`
  const imported =
    args.imported > 0 ? ` Imported ${args.imported} accounts from this machine.` : ''
  return `Signed in to Atlas Cloud${whom}.${imported}`
}

/**
 * The device code's clock keeps ticking while settings stays open, so the poll re-reads the held
 * state rather than trusting a closure — an escape, a page change, or a re-render mid-poll must
 * stop it. Same invariant as the provider device flow in use-accounts.
 */
export function useSettingsCloudLogin(args: {
  cloud: CloudService
  openUrl: UrlOpener
  onSignedIn: () => void
}): SettingsCloudLoginControl {
  const { cloud, openUrl, onSignedIn } = args
  const [state, setState] = useState<SettingsLoginState>(idleLogin)
  const held = useRef(state)
  held.current = state
  const login = useRef<{ ticket: CloudLoginTicket; deadline: number; intervalMs: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const put = useCallback((next: SettingsLoginState) => {
    held.current = next
    setState(next)
  }, [])

  const clearTimer = useCallback(() => {
    login.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const stop = useCallback(() => {
    clearTimer()
    put(idleLogin())
  }, [clearTimer, put])

  const failOpen = useCallback(
    (error: unknown) => {
      clearTimer()
      put(failedLogin(reasonOf(error)))
    },
    [clearTimer, put],
  )

  const poll = useCallback(() => {
    const open = login.current
    if (open === null || held.current.status !== ESettingsLogin.Prompting) return

    if (Date.now() > open.deadline) {
      clearTimer()
      put(failedLogin('that code expired.'))
      return
    }

    void pollCloudLogin({ ticket: open.ticket })
      .then((result) => {
        if (login.current === null || held.current.status !== ESettingsLogin.Prompting) return

        if (result.status === ECloudLoginPoll.Approved) {
          const { ticket } = open
          clearTimer()
          put(finishingLogin())
          void cloud
            .finishLogin({ ticket, token: result.token })
            .then((finished) => {
              put(
                signedInLogin(
                  signedInNotice({ email: finished.session.email, imported: finished.imported }),
                ),
              )
              onSignedIn()
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

        clearTimer()
        put(
          failedLogin(
            result.status === ECloudLoginPoll.Denied
              ? 'that sign-in was refused.'
              : 'that code expired.',
          ),
        )
      })
      .catch(failOpen)
  }, [cloud, failOpen, onSignedIn, put])

  const begin = useCallback(() => {
    clearTimer()
    put(askingLogin())

    void cloud
      .beginLogin()
      .then((ticket) => {
        if (held.current.status !== ESettingsLogin.Asking) return

        const intervalMs = Math.max(ticket.intervalMs, 3000)
        login.current = { ticket, deadline: Date.now() + ticket.expiresInMs, intervalMs }
        put(promptingLogin({ url: ticket.verificationUrl, userCode: ticket.userCode }))
        openUrl(ticket.verificationUrl)
        timer.current = setTimeout(poll, intervalMs)
      })
      .catch(failOpen)
  }, [clearTimer, cloud, failOpen, openUrl, poll, put])

  return { state, begin, stop }
}
