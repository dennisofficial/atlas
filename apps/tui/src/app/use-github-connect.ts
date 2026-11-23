import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { GithubAccountView } from '../ui/components/settings/github-connect'
import {
  askingLogin,
  ESettingsLogin,
  failedLogin,
  idleLogin,
  promptingLogin,
  signedInLogin,
  type SettingsLoginState,
} from '../ui/settings-login-model'
import type { GithubDeviceCodes, SessionApi } from './session-api'

const MIN_POLL_INTERVAL_MS = 3000
const SLOW_DOWN_STEP_MS = 5000

const CONNECTED = 'connected'
const PENDING = 'pending'
const SLOW_DOWN = 'slow-down'
const MISSING_SCOPES = 'missing-scopes'
const DENIED = 'denied'

export type GithubControl = GithubAccountView & {
  refresh: () => void
  stop: () => void
}

type Status = { login: string | null; unreachable: boolean }

const IDLE_STATUS: Status = { login: null, unreachable: false }

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'the request failed'

export function useGithubConnect(args: {
  api: SessionApi | null
  openUrl: (url: string) => void
  minPollIntervalMs?: number | undefined
}): GithubControl {
  const { api, openUrl, minPollIntervalMs = MIN_POLL_INTERVAL_MS } = args
  const [status, setStatus] = useState<Status>(IDLE_STATUS)
  const [flow, setFlow] = useState<SettingsLoginState>(idleLogin)
  const held = useRef(flow)
  held.current = flow
  const ticket = useRef<{ codes: GithubDeviceCodes; deadline: number; intervalMs: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const put = useCallback((next: SettingsLoginState) => {
    held.current = next
    setFlow(next)
  }, [])

  const clearTimer = useCallback(() => {
    ticket.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const stop = useCallback(() => {
    clearTimer()
    put(idleLogin())
  }, [clearTimer, put])

  const refresh = useCallback(() => {
    if (api === null) {
      setStatus(IDLE_STATUS)
      return
    }

    void api.githubState().then(
      (state) => {
        setStatus({ login: state.connected ? state.login : null, unreachable: false })
      },
      () => {
        setStatus({ login: null, unreachable: true })
      },
    )
  }, [api])

  const failOpen = useCallback(
    (failure: unknown) => {
      clearTimer()
      put(failedLogin(reasonOf(failure)))
    },
    [clearTimer, put],
  )

  const poll = useCallback(() => {
    const open = ticket.current
    if (api === null || open === null || held.current.status !== ESettingsLogin.Prompting) return

    if (Date.now() > open.deadline) {
      clearTimer()
      put(failedLogin('that code expired.'))
      return
    }

    void api.pollGithubConnect({ deviceCode: open.codes.deviceCode }).then((result) => {
      if (ticket.current === null || held.current.status !== ESettingsLogin.Prompting) return

      if (result.status === CONNECTED) {
        clearTimer()
        put(signedInLogin(`Connected GitHub as @${result.login}.`))
        refresh()
        return
      }

      if (result.status === PENDING) {
        timer.current = setTimeout(poll, open.intervalMs)
        return
      }

      if (result.status === SLOW_DOWN) {
        open.intervalMs += SLOW_DOWN_STEP_MS
        timer.current = setTimeout(poll, open.intervalMs)
        return
      }

      if (result.status === MISSING_SCOPES) {
        clearTimer()
        put(
          failedLogin(
            `github granted no ${result.missing.join(', ')} scope — the oauth app registration cannot issue the access Atlas needs.`,
          ),
        )
        return
      }

      clearTimer()
      put(
        failedLogin(
          result.status === DENIED ? 'that connection was refused.' : 'that code expired.',
        ),
      )
    }, failOpen)
  }, [api, clearTimer, failOpen, put, refresh])

  const begin = useCallback(() => {
    if (api === null) {
      put(failedLogin('sign in to Atlas Cloud first.'))
      return
    }

    clearTimer()
    put(askingLogin())

    void api.beginGithubConnect().then((codes) => {
      if (held.current.status !== ESettingsLogin.Asking) return

      const intervalMs = Math.max(codes.intervalMs, minPollIntervalMs)
      ticket.current = { codes, deadline: Date.now() + codes.expiresInMs, intervalMs }
      put(promptingLogin({ url: codes.verificationUrl, userCode: codes.userCode }))
      openUrl(codes.verificationUrl)
      timer.current = setTimeout(poll, intervalMs)
    }, failOpen)
  }, [api, clearTimer, failOpen, minPollIntervalMs, openUrl, poll, put])

  const disconnect = useCallback(() => {
    if (api === null) return

    void api.disconnectGithub().then(() => {
      put(signedInLogin('Disconnected GitHub.'))
      refresh()
    }, failOpen)
  }, [api, failOpen, put, refresh])

  const handleActivate = useCallback(() => {
    if (held.current.status !== ESettingsLogin.Idle) return

    if (status.login !== null) {
      disconnect()
      return
    }
    begin()
  }, [begin, disconnect, status.login])

  useEffect(() => () => clearTimer(), [clearTimer])

  return useMemo(
    () => ({
      connection: status.login === null ? null : { login: status.login },
      unreachable: status.unreachable,
      flow,
      onActivate: handleActivate,
      onOpenUrl: () => {
        const opened = flow.prompt
        if (opened !== null) openUrl(opened.url)
      },
      refresh,
      stop,
    }),
    [flow, handleActivate, openUrl, refresh, status.login, status.unreachable, stop],
  )
}
