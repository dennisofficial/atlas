import { useCallback, useRef } from 'react'

import type { CloudClient, CloudService, GithubConnectTicket, UrlOpener } from '@dltech/atlas-harness'
import { EGithubConnectPoll } from '@dltech/atlas-harness'

import {
  announced,
  askForGithubCode,
  backToList,
  EAccountsView,
  failed,
  type AccountsState,
  type GithubRowState,
} from '../ui/accounts-model'

export type GithubConnectControl = {
  begin: (current: AccountsState) => void
  disconnect: () => void
  stop: () => void
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export const githubRow = async (client: CloudClient): Promise<GithubRowState> => {
  try {
    const connection = await client.githubConnection()
    return {
      connection: connection === null ? null : { login: connection.login },
      unreachable: false,
    }
  } catch {
    return { connection: null, unreachable: true }
  }
}

/**
 * The device code's clock keeps ticking while the drawer is open, so the poll re-reads the held
 * state rather than trusting a closure — an escape or a re-render mid-poll must stop it. Same
 * invariant as the cloud sign-in flow in use-cloud-login.
 */
export function useGithubConnect(args: {
  cloud: CloudService
  openUrl: UrlOpener
  held: { current: AccountsState | null }
  put: (next: AccountsState | null) => void
  refresh: (change?: (state: AccountsState) => AccountsState) => void
}): GithubConnectControl {
  const { cloud, openUrl, held, put, refresh } = args
  const connect = useRef<{ ticket: GithubConnectTicket; deadline: number; intervalMs: number } | null>(
    null,
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    connect.current = null
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
    const open = connect.current
    const current = held.current
    if (open === null || current === null || current.view !== EAccountsView.GithubDevice) return

    const client = cloud.client()
    if (client === null) return

    if (Date.now() > open.deadline) {
      stop()
      put(failed({ state: current, reason: 'that code expired.' }))
      return
    }

    void client
      .pollGithubConnect({ deviceCode: open.ticket.deviceCode })
      .then((result) => {
        const now = held.current
        if (now === null || now.view !== EAccountsView.GithubDevice) return

        if (result.status === EGithubConnectPoll.Connected) {
          stop()
          refresh((next) => ({
            ...backToList(next),
            notice: `Connected GitHub as @${result.connection.login}.`,
          }))
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

        stop()
        const reason =
          result.status === EGithubConnectPoll.Denied
            ? 'that connection was refused.'
            : 'that code expired.'
        put(failed({ state: now, reason }))
      })
      .catch(failOpen)
  }, [cloud, held, put, refresh, stop, failOpen])

  const begin = useCallback(
    (current: AccountsState) => {
      const client = cloud.client()
      if (client === null) {
        put(failed({ state: current, reason: 'sign in to Atlas Cloud first.' }))
        return
      }

      put(askForGithubCode({ state: current }))

      void client
        .beginGithubConnect()
        .then((ticket) => {
          const now = held.current
          if (now === null || now.view !== EAccountsView.GithubDevice) return

          const intervalMs = Math.max(ticket.intervalMs, 3000)
          connect.current = { ticket, deadline: Date.now() + ticket.expiresInMs, intervalMs }
          put(
            askForGithubCode({
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

  const disconnect = useCallback(() => {
    const client = cloud.client()
    if (client === null) return

    void client
      .disconnectGithub()
      .then(() => refresh((next) => announced({ state: next, notice: 'Disconnected GitHub.' })))
      .catch(failOpen)
  }, [cloud, refresh, failOpen])

  return { begin, disconnect, stop }
}
