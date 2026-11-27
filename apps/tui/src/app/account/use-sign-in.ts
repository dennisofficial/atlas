import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  beginCloudLogin,
  createPkcePair,
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
  isSettlingLogin,
  promptingLogin,
  waitingLogin,
  type SettingsLoginState,
} from '../../ui/settings-login-model'
import {
  startLoopbackWait,
  type LoopbackReturn,
  type LoopbackWait,
} from '../browser-return/loopback-server'
import { ELoginFlow, loginFlowOf } from './login-flow'
import {
  authorizeUrlOf,
  DESKTOP_CALLBACK_PATH,
  LOGIN_COPY,
  loginRedirectUriOf,
  loginReturnOf,
  type LoginReturn,
} from './login-loopback'
import type { LoginExchange } from './login-exchange'

const MIN_INTERVAL_MS = 3_000

const SLOW_DOWN_MS = 5_000

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

const isEnterKey = (key: KeyEvent): boolean => key.name === 'return' || key.name === 'enter'

export type LoopbackStarter = (args: LoopbackWait<LoginReturn>) => LoopbackReturn<LoginReturn>

export type SignInControl = {
  state: SettingsLoginState
  begin: () => void
  stop: () => void
  switchToCode: () => void
  handleKey: (key: KeyEvent) => void
}

export function useSignIn(args: {
  apiUrl: string
  webOrigin: string
  env: Record<string, string | undefined>
  platform: string
  openUrl: (url: string) => void
  exchange: LoginExchange
  startWait?: LoopbackStarter | undefined
  fetchFn?: typeof fetch | undefined
  onApproved: (result: { token: string }) => void | Promise<void>
}): SignInControl {
  const { apiUrl, webOrigin, exchange, fetchFn, onApproved, openUrl } = args
  const startWait = args.startWait ?? startLoopbackWait
  const [state, setState] = useState<SettingsLoginState>(idleLogin)
  const held = useRef(state)
  held.current = state
  const flow = useMemo(
    () => loginFlowOf({ env: args.env, platform: args.platform }),
    [args.env, args.platform],
  )
  const device = useRef<{ ticket: CloudLoginTicket; deadline: number; intervalMs: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loopback = useRef<LoopbackReturn<LoginReturn> | null>(null)
  const run = useRef(0)

  const put = useCallback((next: SettingsLoginState) => {
    held.current = next
    setState(next)
  }, [])

  const clearDevice = useCallback(() => {
    device.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const clearLoopback = useCallback(() => {
    loopback.current?.stop()
    loopback.current = null
  }, [])

  const failOpen = useCallback(
    (error: unknown) => {
      clearDevice()
      put(failedLogin(reasonOf(error)))
    },
    [clearDevice, put],
  )

  const settleLogin = useCallback(
    async (settling: { attempt: number; login: Parameters<LoginExchange>[0] }) => {
      put(finishingLogin())
      try {
        const token = await exchange(settling.login)
        if (settling.attempt !== run.current) return
        await onApproved({ token })
        if (settling.attempt !== run.current) return
        put(idleLogin())
      } catch (error) {
        if (settling.attempt !== run.current) return
        put(failedLogin(reasonOf(error)))
      }
    },
    [exchange, onApproved, put],
  )

  const poll = useCallback(() => {
    const open = device.current
    if (open === null || held.current.status !== ESettingsLogin.Prompting) return

    if (Date.now() > open.deadline) {
      clearDevice()
      put(failedLogin('that code expired.'))
      return
    }

    void pollCloudLogin(
      fetchFn === undefined ? { ticket: open.ticket } : { ticket: open.ticket, fetchFn },
    )
      .then((result) => {
        if (device.current === null || held.current.status !== ESettingsLogin.Prompting) return

        if (result.status === ECloudLoginPoll.Approved) {
          clearDevice()
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

        clearDevice()
        put(
          failedLogin(
            result.status === ECloudLoginPoll.Denied
              ? 'that sign-in was refused.'
              : 'that code expired.',
          ),
        )
      })
      .catch(failOpen)
  }, [clearDevice, failOpen, fetchFn, onApproved, put])

  const startDevice = useCallback(() => {
    clearDevice()
    put(askingLogin())

    void beginCloudLogin(fetchFn === undefined ? { url: apiUrl } : { url: apiUrl, fetchFn })
      .then((ticket) => {
        if (held.current.status !== ESettingsLogin.Asking) return

        const intervalMs = Math.max(ticket.intervalMs, MIN_INTERVAL_MS)
        device.current = { ticket, deadline: Date.now() + ticket.expiresInMs, intervalMs }
        put(promptingLogin({ url: ticket.verificationUrl, userCode: ticket.userCode }))
        openUrl(ticket.verificationUrl)
        timer.current = setTimeout(poll, intervalMs)
      })
      .catch(failOpen)
  }, [apiUrl, clearDevice, failOpen, fetchFn, openUrl, poll, put])

  const startLoopback = useCallback(() => {
    const ticket = ++run.current
    clearDevice()
    put(askingLogin())

    void createPkcePair()
      .then((pair) => {
        if (run.current !== ticket) return undefined

        let listener: LoopbackReturn<LoginReturn>
        try {
          listener = startWait({
            spec: {
              state: pair.state,
              path: DESKTOP_CALLBACK_PATH,
              hrefOf: (port) =>
                authorizeUrlOf({
                  webOrigin,
                  redirectUri: loginRedirectUriOf(port),
                  challenge: pair.challenge,
                  state: pair.state,
                }),
              readReturn: (url) => loginReturnOf({ url, state: pair.state }),
            },
            open: openUrl,
            copy: LOGIN_COPY,
          })
        } catch {
          if (run.current === ticket) startDevice()
          return undefined
        }

        loopback.current = listener
        put(waitingLogin(listener.href))

        return listener.outcome.then((login) => {
          if (run.current !== ticket) return undefined
          loopback.current = null
          if (login === undefined) {
            startDevice()
            return undefined
          }
          return settleLogin({
            attempt: ticket,
            login: {
              code: login.code,
              codeVerifier: pair.verifier,
              redirectUri: loginRedirectUriOf(listener.port),
            },
          })
        })
      })
      .catch(failOpen)
  }, [clearDevice, failOpen, openUrl, put, settleLogin, startDevice, startWait, webOrigin])

  useEffect(
    () => () => {
      run.current += 1
      clearLoopback()
      clearDevice()
    },
    [clearDevice, clearLoopback],
  )

  const begin = useCallback(() => {
    if (flow === ELoginFlow.Loopback) {
      startLoopback()
      return
    }
    startDevice()
  }, [flow, startDevice, startLoopback])

  const stop = useCallback(() => {
    run.current += 1
    clearLoopback()
    clearDevice()
    put(idleLogin())
  }, [clearDevice, clearLoopback, put])

  const switchToCode = useCallback(() => {
    run.current += 1
    clearLoopback()
    startDevice()
  }, [clearLoopback, startDevice])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (isEnterKey(key) && !isSettlingLogin(state.status)) begin()
      else if (key.name === 'c' && state.status === ESettingsLogin.Browser) switchToCode()
      else if (key.name === 'escape') stop()
    },
    [begin, state.status, stop, switchToCode],
  )

  return { state, begin, stop, switchToCode, handleKey }
}
