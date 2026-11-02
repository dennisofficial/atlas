import { useCallback, useRef, type RefObject } from 'react'

import type { EAuthProvider } from '@dltech/atlas-core'
import { EDevicePoll } from '@dltech/atlas-harness'
import type { AccountsService, DeviceTicket, UrlOpener } from '@dltech/atlas-harness'

import {
  askForDeviceCode,
  backToList,
  EAccountsView,
  failed,
  type AccountsState,
} from '../ui/accounts-model'

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the request failed'

export type DeviceLogin = {
  begin: (args: { state: AccountsState; provider: EAuthProvider }) => void
  stop: () => void
}

export function useDeviceLogin(args: {
  accounts: AccountsService
  openUrl: UrlOpener
  held: RefObject<AccountsState | null>
  put: (next: AccountsState | null) => void
  refresh: (change: (state: AccountsState) => AccountsState) => void
}): DeviceLogin {
  const { accounts, openUrl, held, put, refresh } = args
  const device = useRef<{ ticket: DeviceTicket; deadline: number } | null>(null)
  const deviceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopDevice = useCallback(() => {
    device.current = null
    if (deviceTimer.current !== null) clearTimeout(deviceTimer.current)
    deviceTimer.current = null
  }, [])

  /**
   * The device code's clock keeps ticking while the drawer is open, so the poll re-reads the held
   * state rather than trusting a closure — an escape or a re-render mid-poll must stop it.
   */
  const pollDevice = useCallback(() => {
    const open = device.current
    const current = held.current
    if (open === null || current === null || current.view !== EAccountsView.DeviceCode) return

    if (Date.now() > open.deadline) {
      stopDevice()
      put(failed({ state: current, reason: 'that code expired — start again from actions.' }))
      return
    }

    void accounts
      .pollDevice(open.ticket)
      .then((result) => {
        const now = held.current
        if (now === null || now.view !== EAccountsView.DeviceCode) return

        if (result.status === EDevicePoll.Pending) {
          deviceTimer.current = setTimeout(pollDevice, Math.max(open.ticket.intervalMs, 3000))
          return
        }

        stopDevice()
        refresh((next) => ({
          ...backToList(next),
          notice: `Signed in as ${result.account.label}.`,
        }))
      })
      .catch((error: unknown) => {
        stopDevice()
        const now = held.current
        if (now !== null) put(failed({ state: now, reason: reasonOf(error) }))
      })
  }, [accounts, held, put, refresh, stopDevice])

  const beginDevice = useCallback(
    ({ state: current, provider }: { state: AccountsState; provider: EAuthProvider }) => {
      put(askForDeviceCode({ state: current, prompt: { provider, url: '' } }))

      void accounts
        .beginDevice(provider)
        .then((begun) => {
          const now = held.current
          if (now === null || now.view !== EAccountsView.DeviceCode) return

          device.current = { ticket: begun, deadline: Date.now() + begun.expiresInMs }
          put(
            askForDeviceCode({
              state: now,
              prompt: {
                provider: begun.provider,
                url: begun.verificationUrl,
                userCode: begun.userCode,
              },
            }),
          )
          openUrl(begun.verificationUrl)
          deviceTimer.current = setTimeout(pollDevice, Math.max(begun.intervalMs, 3000))
        })
        .catch((error: unknown) => {
          const now = held.current
          if (now !== null) put(failed({ state: now, reason: reasonOf(error) }))
        })
    },
    [accounts, held, openUrl, pollDevice, put],
  )

  return { begin: beginDevice, stop: stopDevice }
}
