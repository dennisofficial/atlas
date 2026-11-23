import { useCallback, useRef, useState } from 'react'

import {
  beginCloudLogin,
  ECloudLoginPoll,
  pollCloudLogin,
  type CloudLoginTicket,
} from '@dltech/atlas-client/account'

import {
  askingLogin,
  ESettingsLogin,
  failedLogin,
  finishingLogin,
  idleLogin,
  promptingLogin,
  type SettingsLoginState,
} from '../../ui/settings-login-model'

export type DeviceSignInControl = {
  state: SettingsLoginState
  begin: () => void
  stop: () => void
}

const MIN_INTERVAL_MS = 3_000

const SLOW_DOWN_MS = 5_000

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export function useDeviceSignIn(args: {
  apiUrl: string
  openUrl: (url: string) => void
  fetchFn?: typeof fetch | undefined
  onApproved: (result: { token: string }) => void | Promise<void>
}): DeviceSignInControl {
  const { apiUrl, openUrl, fetchFn, onApproved } = args
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

    void pollCloudLogin(
      fetchFn === undefined ? { ticket: open.ticket } : { ticket: open.ticket, fetchFn },
    )
      .then((result) => {
        if (login.current === null || held.current.status !== ESettingsLogin.Prompting) return

        if (result.status === ECloudLoginPoll.Approved) {
          clearTimer()
          put(finishingLogin())
          void Promise.resolve(onApproved({ token: result.token }))
            .then(() => put(idleLogin()))
            .catch(failOpen)
          return
        }

        if (result.status === ECloudLoginPoll.Pending) {
          timer.current = setTimeout(poll, open.intervalMs)
          return
        }

        if (result.status === ECloudLoginPoll.SlowDown) {
          open.intervalMs += SLOW_DOWN_MS
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
  }, [clearTimer, failOpen, fetchFn, onApproved, put])

  const begin = useCallback(() => {
    clearTimer()
    put(askingLogin())

    void beginCloudLogin(fetchFn === undefined ? { url: apiUrl } : { url: apiUrl, fetchFn })
      .then((ticket) => {
        if (held.current.status !== ESettingsLogin.Asking) return

        const intervalMs = Math.max(ticket.intervalMs, MIN_INTERVAL_MS)
        login.current = { ticket, deadline: Date.now() + ticket.expiresInMs, intervalMs }
        put(promptingLogin({ url: ticket.verificationUrl, userCode: ticket.userCode }))
        openUrl(ticket.verificationUrl)
        timer.current = setTimeout(poll, intervalMs)
      })
      .catch(failOpen)
  }, [apiUrl, clearTimer, failOpen, fetchFn, openUrl, poll, put])

  return { state, begin, stop }
}
