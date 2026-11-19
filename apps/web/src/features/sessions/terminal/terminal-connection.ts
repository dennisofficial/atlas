'use client'

import { useCallback, useEffect, useRef } from 'react'

import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import type { TerminalTransportOf } from './terminal-api'
import {
  type TerminalProblem,
  cursorsOf,
  retryDelayMs,
  withLink,
  withProblem,
  withRows,
} from './terminal-model'
import type { TerminalTransport } from './terminal-transport'
import type { TerminalStore } from './terminals-store'

export type PendingFrame = { terminalId: string; offset: number; data: Uint8Array }

type TerminalConnectionArgs = {
  live: boolean
  sessionId: string
  transportOf: TerminalTransportOf
  store: TerminalStore
  link: ETerminalConnection
  cwdOf: (terminalId: string) => string | undefined
  onOutput: (frame: PendingFrame) => void
  onExit: (frame: { terminalId: string; exitCode: number | null; signal: string | null }) => void
}

export function useTerminalConnection(args: TerminalConnectionArgs) {
  const { live, sessionId, transportOf, store, link, cwdOf, onOutput, onExit } = args
  const transport = useRef<TerminalTransport | undefined>(undefined)
  const attempts = useRef(0)

  const refresh = useCallback(async () => {
    const active = transport.current
    if (active === undefined) return
    const rows = await active.list().catch(() => undefined)
    if (rows === undefined) return
    store.update((state) => withRows({ snapshot: state, rows, cwdOf }))
  }, [cwdOf, store])

  const handleClosed = useCallback(
    (reason: 'asleep' | 'restarted' | 'detached') => {
      if (reason !== 'restarted') return
      const active = transport.current
      if (active === undefined) return
      void refresh().then(() => active.reconnect(cursorsOf(store.snapshot())))
    },
    [refresh, store],
  )

  const handleLink = useCallback(
    (next: ETerminalConnection) => {
      if (next === ETerminalConnection.Connected) attempts.current = 0
      store.update((state) => withLink(state, next))
    },
    [store],
  )

  const handleProblem = useCallback(
    (problem: TerminalProblem | undefined) => store.update((state) => withProblem(state, problem)),
    [store],
  )

  useEffect(() => {
    if (!live) return undefined
    const opened = transportOf({
      sessionId,
      onOutput,
      onExit,
      onClosed: handleClosed,
      onLink: handleLink,
      onProblem: handleProblem,
    })
    transport.current = opened
    let cancelled = false
    void opened.list().then(
      (rows) => {
        if (cancelled || transport.current !== opened) return
        store.update((state) => withRows({ snapshot: state, rows, cwdOf }))
        opened.reconnect(cursorsOf(store.snapshot()))
      },
      () => undefined,
    )
    return () => {
      cancelled = true
      if (transport.current === opened) transport.current = undefined
      opened.dispose()
    }
  }, [
    live,
    sessionId,
    transportOf,
    store,
    cwdOf,
    onOutput,
    onExit,
    handleClosed,
    handleLink,
    handleProblem,
  ])

  useEffect(() => {
    if (!live || link !== ETerminalConnection.Paused) return undefined
    const timer = setTimeout(() => {
      attempts.current += 1
      const active = transport.current
      if (active !== undefined) active.reconnect(cursorsOf(store.snapshot()))
    }, retryDelayMs(attempts.current))
    return () => clearTimeout(timer)
  }, [live, link, store])

  return { transport, refresh }
}
