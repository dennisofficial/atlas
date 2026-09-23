import { useCallback, useRef, useState } from 'react'

import type { CloudService, GithubConnectTicket, UrlOpener } from '@dltech/atlas-harness'
import { EGithubConnectPoll } from '@dltech/atlas-harness'

import {
  askingLogin,
  ESettingsLogin,
  failedLogin,
  idleLogin,
  promptingLogin,
  signedInLogin,
  type SettingsLoginState,
} from '../ui/settings-login-model'

export type SettingsGithubControl = {
  connection: { login: string } | null
  unreachable: boolean
  flow: SettingsLoginState
  refresh: () => void
  activate: () => void
  stop: () => void
}

type GithubStatus = {
  connection: { login: string } | null
  unreachable: boolean
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

const IDLE_STATUS: GithubStatus = { connection: null, unreachable: false }

/**
 * The device code's clock keeps ticking while settings stays open, so the poll re-reads the held
 * state rather than trusting a closure — an escape, a page change, or a re-render mid-poll must
 * stop it. Same invariant as the cloud sign-in flow in use-settings-cloud-login.
 */
export function useSettingsGithub(args: {
  cloud: CloudService
  openUrl: UrlOpener
}): SettingsGithubControl {
  const { cloud, openUrl } = args
  const [status, setStatus] = useState<GithubStatus>(IDLE_STATUS)
  const [flow, setFlow] = useState<SettingsLoginState>(idleLogin)
  const held = useRef(flow)
  held.current = flow
  const connect = useRef<{ ticket: GithubConnectTicket; deadline: number; intervalMs: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const put = useCallback((next: SettingsLoginState) => {
    held.current = next
    setFlow(next)
  }, [])

  const putStatus = useCallback((next: GithubStatus) => {
    setStatus((current) =>
      current.unreachable === next.unreachable && current.connection?.login === next.connection?.login
        ? current
        : next,
    )
  }, [])

  const clearTimer = useCallback(() => {
    connect.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const stop = useCallback(() => {
    clearTimer()
    put(idleLogin())
  }, [clearTimer, put])

  const refresh = useCallback(() => {
    const client = cloud.client()
    if (client === null) {
      putStatus(IDLE_STATUS)
      return
    }

    void client
      .githubConnection()
      .then((found) => {
        putStatus({
          connection: found === null ? null : { login: found.login },
          unreachable: false,
        })
      })
      .catch(() => {
        putStatus({ connection: null, unreachable: true })
      })
  }, [cloud, putStatus])

  const failOpen = useCallback(
    (error: unknown) => {
      clearTimer()
      put(failedLogin(reasonOf(error)))
    },
    [clearTimer, put],
  )

  const poll = useCallback(() => {
    const open = connect.current
    if (open === null || held.current.status !== ESettingsLogin.Prompting) return

    const client = cloud.client()
    if (client === null) return

    if (Date.now() > open.deadline) {
      clearTimer()
      put(failedLogin('that code expired.'))
      return
    }

    void client
      .pollGithubConnect({ deviceCode: open.ticket.deviceCode })
      .then((result) => {
        if (connect.current === null || held.current.status !== ESettingsLogin.Prompting) return

        if (result.status === EGithubConnectPoll.Connected) {
          clearTimer()
          put(signedInLogin(`Connected GitHub as @${result.connection.login}.`))
          refresh()
          return
        }

        if (result.status === EGithubConnectPoll.Pending) {
          timer.current = setTimeout(poll, open.intervalMs)
          return
        }

        if (result.status === EGithubConnectPoll.SlowDown) {
          open.intervalMs += 5000
          timer.current = setTimeout(poll, open.intervalMs)
          return
        }

        clearTimer()
        put(
          failedLogin(
            result.status === EGithubConnectPoll.Denied
              ? 'that connection was refused.'
              : 'that code expired.',
          ),
        )
      })
      .catch(failOpen)
  }, [cloud, clearTimer, failOpen, put, refresh])

  const begin = useCallback(() => {
    const client = cloud.client()
    if (client === null) {
      put(failedLogin('sign in to Atlas Cloud first.'))
      return
    }

    clearTimer()
    put(askingLogin())

    void client
      .beginGithubConnect()
      .then((ticket) => {
        if (held.current.status !== ESettingsLogin.Asking) return

        const intervalMs = Math.max(ticket.intervalMs, 3000)
        connect.current = { ticket, deadline: Date.now() + ticket.expiresInMs, intervalMs }
        put(promptingLogin({ url: ticket.verificationUrl, userCode: ticket.userCode }))
        openUrl(ticket.verificationUrl)
        timer.current = setTimeout(poll, intervalMs)
      })
      .catch(failOpen)
  }, [clearTimer, cloud, failOpen, openUrl, poll, put])

  const disconnect = useCallback(() => {
    const client = cloud.client()
    if (client === null) return

    void client
      .disconnectGithub()
      .then(() => {
        put(signedInLogin('Disconnected GitHub.'))
        refresh()
      })
      .catch(failOpen)
  }, [cloud, failOpen, put, refresh])

  const activate = useCallback(() => {
    if (held.current.status !== ESettingsLogin.Idle) return

    if (status.connection !== null) {
      disconnect()
      return
    }
    begin()
  }, [begin, disconnect, status.connection])

  return {
    connection: status.connection,
    unreachable: status.unreachable,
    flow,
    refresh,
    activate,
    stop,
  }
}
