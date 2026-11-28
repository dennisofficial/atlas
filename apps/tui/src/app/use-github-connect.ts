import { EReturnResult, stateOfStartLink } from '@dltech/atlas-core'
import { ELoginFlow, loginFlowOf } from './account/login-flow'
import type { BrowserReturnOpener } from './browser-return/open'
import {
  createGithubBrowserReturn,
  GITHUB_RETURN_COPY,
  type GithubConnectApi,
} from './github-browser-return'
import { useReturnOutcome } from './browser-return/use-return-outcome'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { GithubAccountView } from '../ui/components/settings/github-connect'
import {
  askingLogin,
  ESettingsLogin,
  failedLogin,
  idleLogin,
  promptingLogin,
  signedInLogin,
  waitingLogin,
  type SettingsLoginState,
} from '../ui/settings-login-model'
import type { GithubDeviceCodes } from './session-api'

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
  api: GithubConnectApi | null
  env?: Record<string, string | undefined>
  platform?: string
  opener?: BrowserReturnOpener
  openUrl: (url: string) => void
  minPollIntervalMs?: number | undefined
}): GithubControl {
  const { api, openUrl, minPollIntervalMs = MIN_POLL_INTERVAL_MS } = args
  const generation = useRef(0)
  const fallback = useRef(() => {})
  const opener = useMemo(
    () => args.opener ?? createGithubBrowserReturn({ generation, fallback }),
    [args.opener],
  )
  const [returnState, setReturnState] = useState<string>()
  const outcome = useReturnOutcome({ state: returnState, durable: undefined })
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
    generation.current += 1
    opener.stop()
    setReturnState(undefined)
    ticket.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [opener])

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

    void api.pollGithubConnect({ deviceCode: open.codes.deviceCode }).then(
      (result) => {
        if (ticket.current !== open || held.current.status !== ESettingsLogin.Prompting) return

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
      },
      (failure: unknown) => {
        if (ticket.current === open) failOpen(failure)
      },
    )
  }, [api, clearTimer, failOpen, put, refresh])

  const beginDevice = useCallback(() => {
    if (api === null) {
      put(failedLogin('sign in to Atlas Cloud first.'))
      return
    }

    clearTimer()
    put(askingLogin())

    const id = generation.current
    void api.beginGithubConnect().then(
      (codes) => {
        if (generation.current !== id || held.current.status !== ESettingsLogin.Asking) return

        const intervalMs = Math.max(codes.intervalMs, minPollIntervalMs)
        ticket.current = { codes, deadline: Date.now() + codes.expiresInMs, intervalMs }
        put(promptingLogin({ url: codes.verificationUrl, userCode: codes.userCode }))
        openUrl(codes.verificationUrl)
        timer.current = setTimeout(poll, intervalMs)
      },
      (failure: unknown) => {
        if (generation.current === id) failOpen(failure)
      },
    )
  }, [api, clearTimer, failOpen, minPollIntervalMs, openUrl, poll, put])

  fallback.current = beginDevice
  const begin = useCallback(() => {
    if (
      api === null ||
      loginFlowOf({ env: args.env ?? process.env, platform: args.platform ?? process.platform }) ===
        ELoginFlow.DeviceCode
    ) {
      beginDevice()
      return
    }
    clearTimer()
    const id = generation.current
    put(askingLogin())
    void api.beginGithubRedirect().then(
      ({ url }) => {
        if (generation.current !== id) return
        try {
          put(waitingLogin(url))
          setReturnState(stateOfStartLink(url))
          opener.open({
            url,
            open: openUrl,
            copy: GITHUB_RETURN_COPY,
          })
        } catch {
          beginDevice()
        }
      },
      (failure: unknown) => {
        if (generation.current === id) failOpen(failure)
      },
    )
  }, [api, args.env, args.platform, beginDevice, clearTimer, failOpen, openUrl, opener, put])

  useEffect(() => {
    if (returnState === undefined || outcome === undefined) return
    clearTimer()
    if (outcome.result === EReturnResult.Connected) {
      put(signedInLogin('Connected GitHub.'))
      refresh()
      return
    }
    put(failedLogin(outcome.reason ?? 'GitHub access was refused.'))
  }, [returnState, outcome, clearTimer, put, refresh])

  const disconnect = useCallback(() => {
    if (api === null) return

    void api.disconnectGithub().then(() => {
      put(signedInLogin('Disconnected GitHub.'))
      refresh()
    }, failOpen)
  }, [api, failOpen, put, refresh])

  const handleActivate = useCallback(() => {
    if (held.current.status === ESettingsLogin.Browser) {
      beginDevice()
      return
    }
    if (held.current.status !== ESettingsLogin.Idle) return

    if (status.login !== null) {
      disconnect()
      return
    }
    begin()
  }, [begin, beginDevice, disconnect, status.login])

  useEffect(() => () => clearTimer(), [clearTimer])
  return useMemo(
    () => ({
      connection: status.login === null ? null : { login: status.login },
      unreachable: status.unreachable,
      flow,
      onActivate: handleActivate,
      onOpenUrl: () => {
        const opened = flow.prompt
        if (opened === null) return
        if (flow.status === ESettingsLogin.Browser) {
          try {
            opener.open({
              url: opened.url,
              open: openUrl,
              copy: GITHUB_RETURN_COPY,
            })
          } catch {
            beginDevice()
          }
          return
        }
        openUrl(opened.url)
      },
      refresh,
      stop,
    }),
    [
      beginDevice,
      flow,
      handleActivate,
      openUrl,
      opener,
      refresh,
      status.login,
      status.unreachable,
      stop,
    ],
  )
}
