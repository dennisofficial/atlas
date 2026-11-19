'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import type { TerminalScreenHandle, TerminalSize } from '@dltech/atlas-ui/ai/terminal-screen'

import { api, cloudCall } from '@/lib/api-client'

import { usePodWake } from '../data/use-pod-wake'
import { useSessionPaneValue } from '../panel/pane-value'
import { PodDisconnected } from '../panel/pod-disconnected'
import { v2TerminalTransport, type TerminalTransportOf } from './terminal-api'
import {
  TerminalEmptyBody,
  TerminalEndedBody,
  TerminalFailedBody,
  TerminalScreens,
} from './terminal-bodies'
import {
  ETerminalTabState,
  activeTab,
  applyExit,
  canOpen,
  closeTab,
  cursorOf,
  cursorsOf,
  isLiveTab,
  renameTab,
  resetCursor,
  selectTab,
  setCursor,
  withLink,
  withRows,
} from './terminal-model'
import { TerminalBreadcrumb, TerminalStatusBar, TerminalStrip } from './terminal-strip'
import { bytesOf, type TerminalTransport, type TerminalTransportArgs } from './terminal-transport'
import { useTerminalStore, useTerminals } from './terminals-store'

const DEFAULT_SIZE = { cols: 80, rows: 24 }
const RECONNECT_DELAY_MS = 3000

const requestWake = (sessionId: string) => cloudCall(api.sessions.wake.mutate({ sessionId }))

type PendingFrame = { terminalId: string; offset: number; data: Uint8Array }

export function TerminalTab(props: { transportOf?: TerminalTransportOf } = {}) {
  const { sessionId, status, checkouts } = useSessionPaneValue()
  const transportOf = props.transportOf ?? v2TerminalTransport
  const store = useTerminalStore(sessionId)
  const snapshot = useTerminals(sessionId)
  const live = status?.lease.live ?? false
  const { state: wakeState, wakePod } = usePodWake({
    sessionId,
    live,
    wake: () => requestWake(sessionId).then(() => undefined),
  })

  const transportRef = useRef<TerminalTransport | undefined>(undefined)
  const screens = useRef(new Map<string, TerminalScreenHandle>())
  const pending = useRef(new Map<string, PendingFrame[]>())
  const replaying = useRef(new Set<string>())
  const cwdMemory = useRef(new Map<string, string>())

  const cwd = useMemo(() => {
    const primary = checkouts.primary
    if (primary === null) return undefined
    const repo = checkouts.repos.find((entry) => entry.repo === primary.repo)
    return (
      repo?.branches.find((branch) => branch.name === primary.branch)?.worktreePath ?? undefined
    )
  }, [checkouts])

  const cwdOf = useCallback((terminalId: string) => cwdMemory.current.get(terminalId) ?? cwd, [cwd])

  const write = useCallback(
    (frame: PendingFrame) => {
      const cursor = cursorOf(store.snapshot(), frame.terminalId)
      const skip = Math.max(0, cursor - frame.offset)
      if (skip < frame.data.length) {
        screens.current.get(frame.terminalId)?.write(frame.data.subarray(skip))
      }
      store.update((state) => setCursor(state, frame.terminalId, frame.offset + frame.data.length))
    },
    [store],
  )

  const handleOutput = useCallback(
    (frame: PendingFrame) => {
      if (replaying.current.has(frame.terminalId)) {
        const list = pending.current.get(frame.terminalId) ?? []
        list.push(frame)
        pending.current.set(frame.terminalId, list)
        return
      }
      write(frame)
    },
    [write],
  )

  const refresh = useCallback(async () => {
    const transport = transportRef.current
    if (transport === undefined) return
    const rows = await transport.list().catch(() => undefined)
    if (rows === undefined) return
    store.update((state) => withRows({ snapshot: state, rows, cwdOf }))
  }, [cwdOf, store])

  const handleClosed = useCallback(
    (reason: 'asleep' | 'restarted' | 'detached') => {
      if (reason !== 'restarted') return
      const transport = transportRef.current
      if (transport === undefined) return
      void refresh().then(() => transport.reconnect(cursorsOf(store.snapshot())))
    },
    [refresh, store],
  )

  const handleLink = useCallback(
    (link: ETerminalConnection) => store.update((state) => withLink(state, link)),
    [store],
  )

  const handleExit = useCallback(
    (frame: { terminalId: string; exitCode: number | null; signal: string | null }) =>
      store.update((state) => applyExit(state, frame)),
    [store],
  )

  useEffect(() => {
    if (!live) return undefined
    const transport = transportOf({
      sessionId,
      onOutput: handleOutput,
      onExit: handleExit,
      onClosed: handleClosed,
      onLink: handleLink,
    })
    transportRef.current = transport
    let cancelled = false
    void transport.list().then(
      (rows) => {
        if (cancelled || transportRef.current !== transport) return
        store.update((state) => withRows({ snapshot: state, rows, cwdOf }))
        transport.reconnect(cursorsOf(store.snapshot()))
      },
      () => undefined,
    )
    return () => {
      cancelled = true
      if (transportRef.current === transport) transportRef.current = undefined
      transport.dispose()
    }
  }, [
    live,
    sessionId,
    transportOf,
    store,
    cwdOf,
    handleOutput,
    handleExit,
    handleClosed,
    handleLink,
  ])

  useEffect(() => {
    if (!live || snapshot.link !== ETerminalConnection.Paused) return undefined
    const timer = setTimeout(() => {
      const transport = transportRef.current
      if (transport !== undefined) transport.reconnect(cursorsOf(store.snapshot()))
    }, RECONNECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [live, snapshot.link, store])

  const handleNew = useCallback(() => {
    const transport = transportRef.current
    if (transport === undefined || !canOpen(store.snapshot())) return
    void transport.open({ ...DEFAULT_SIZE, cwd }).then(
      (result) => {
        if (result.state !== 'open') {
          store.update((state) => withLink(state, ETerminalConnection.Disconnected))
          return
        }
        if (cwd !== undefined) cwdMemory.current.set(result.terminalId, cwd)
        void refresh()
      },
      () => toast.error('Could not open a terminal'),
    )
  }, [cwd, refresh, store])

  const handleSelect = useCallback(
    (terminalId: string) => store.update((state) => selectTab(state, terminalId)),
    [store],
  )

  const handleClose = useCallback(
    (terminalId: string) => {
      store.update((state) => closeTab(state, terminalId))
      screens.current.delete(terminalId)
      const transport = transportRef.current
      if (transport === undefined) return
      void transport.close(terminalId).then(
        () => refresh(),
        () => refresh(),
      )
    },
    [refresh, store],
  )

  const handleRename = useCallback(
    (terminalId: string, name: string) => {
      store.update((state) => renameTab(state, terminalId, name))
      const transport = transportRef.current
      if (transport === undefined) return
      void transport.rename(terminalId, name).then(
        () => refresh(),
        () => refresh(),
      )
    },
    [refresh, store],
  )

  const handleRegister = useCallback((terminalId: string, handle: TerminalScreenHandle | null) => {
    if (handle === null) screens.current.delete(terminalId)
    else screens.current.set(terminalId, handle)
  }, [])

  const handleScreenReady = useCallback(
    (terminalId: string) => {
      const transport = transportRef.current
      if (transport === undefined) return
      replaying.current.add(terminalId)
      store.update((state) => resetCursor(state, terminalId))
      void transport.read(terminalId, 0).then(
        (result) => {
          replaying.current.delete(terminalId)
          const data = bytesOf(result.data)
          const screen = screens.current.get(terminalId)
          if (data.length > 0) screen?.write(data)
          store.update((state) => setCursor(state, terminalId, result.offset + data.length))
          for (const frame of pending.current.get(terminalId) ?? []) write(frame)
          pending.current.delete(terminalId)
          screen?.focus()
        },
        () => replaying.current.delete(terminalId),
      )
    },
    [store, write],
  )

  const handleData = useCallback(
    (terminalId: string, data: string) => transportRef.current?.write(terminalId, data),
    [],
  )

  const handleResize = useCallback((terminalId: string, size: TerminalSize) => {
    transportRef.current?.resize(terminalId, size.cols, size.rows)
  }, [])

  if (!live || snapshot.link === ETerminalConnection.Disconnected) {
    return <PodDisconnected tab="Terminal" state={wakeState} onWake={wakePod} />
  }

  const active = activeTab(snapshot)
  const liveTabs = snapshot.tabs.filter(isLiveTab)
  const screenVisible = active !== undefined && isLiveTab(active)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {snapshot.tabs.length > 0 ? (
        <>
          <TerminalStrip
            tabs={snapshot.tabs}
            activeId={snapshot.activeId}
            canCreate={canOpen(snapshot)}
            onSelect={handleSelect}
            onClose={handleClose}
            onRename={handleRename}
            onNew={handleNew}
          />
          {active?.cwd === undefined ? null : <TerminalBreadcrumb cwd={active.cwd} />}
        </>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {snapshot.tabs.length === 0 ? (
          <TerminalEmptyBody onCreate={handleNew} />
        ) : (
          <>
            <div
              className={
                screenVisible ? 'flex min-h-0 flex-1 flex-col' : 'hidden min-h-0 flex-1 flex-col'
              }
            >
              <TerminalScreens
                tabs={liveTabs}
                activeId={screenVisible ? snapshot.activeId : undefined}
                register={handleRegister}
                onReady={handleScreenReady}
                onData={handleData}
                onResize={handleResize}
              />
            </div>
            {active === undefined || screenVisible ? null : active.state ===
              ETerminalTabState.Failed ? (
              <TerminalFailedBody tab={active} onClose={() => handleClose(active.row.terminalId)} />
            ) : (
              <TerminalEndedBody tab={active} onClose={() => handleClose(active.row.terminalId)} />
            )}
          </>
        )}
      </div>
      <TerminalStatusBar tab={active} count={snapshot.tabs.length} />
    </div>
  )
}

export type TerminalTabProps = Parameters<typeof TerminalTab>[0]
export type { TerminalTransportArgs }
