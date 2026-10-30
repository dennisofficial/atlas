import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState, useEffect } from 'react'

import { foldServices } from '@dltech/atlas-core'

import type { ThreadId } from '@dltech/atlas-core'
import type { ServiceSnapshot } from '@dltech/atlas-harness'

import type { SidebarCrewFold } from '../store/subagent-row'
import { useOutputScroll, type OutputScroll } from '../ui/hooks/use-output-scroll'
import {
  buildServiceRows,
  isRowRunning,
  isServiceAlive,
  isServiceRunning,
  moveServiceSelection,
  openServices,
  rowActions,
  rowServiceId,
  rowTone,
  selectedService,
  selectService,
  EServiceTone,
  type ServiceRow,
  type ServicesState,
} from '../ui/services-model'
import { outputScrollCommand } from '../ui/shells-model'
import { useTickingNow } from './use-ticking-now'
import type { AtlasApp } from './compose'
import { useDeclaredServices } from './use-declared-services'

const POLL_MS = 500

const PEEKED_CHARACTERS = 64_000

const STOP_KEYS = new Set(['k', 'x'])

const START_KEY = 's'

const RESTART_KEY = 'r'

export type ServicesControl = {
  services: readonly ServiceSnapshot[]
  folded: readonly ServiceSnapshot[]
  fold: SidebarCrewFold
  everywhere: readonly ServiceSnapshot[]
  rows: readonly ServiceRow[]
  sidebarRows: readonly ServiceRow[]
  declaredTotal: number
  declaredRunning: number
  attention: boolean
  notice: string | null
  running: number
  now: number
  state: ServicesState | null
  selected: ServiceRow | undefined
  log: string
  scroll: OutputScroll
  handleOpen: (key?: string) => void
  handleDismiss: () => void
  handleSelect: (key: string) => void
  handleStart: (name: string) => void
  handleRestart: (serviceId: string) => void
  handleStop: (serviceId: string) => void
  handleKey: (key: KeyEvent) => void
}

const sameServices = (
  left: readonly ServiceSnapshot[],
  right: readonly ServiceSnapshot[],
): boolean => {
  if (left.length !== right.length) return false

  return left.every((service, index) => {
    const other = right[index]
    if (other === undefined) return false
    return (
      service.serviceId === other.serviceId &&
      service.status === other.status &&
      service.exitCode === other.exitCode
    )
  })
}

/**
 * The registry publishes on start and exit, so the roster re-reads on real changes instead of a
 * timer; the snapshot comparison keeps the tree still when a notice changed nothing visible.
 * Services are session-global, so the sidebar and the exit guard read the same subscription.
 */
export function useServices({
  app,
  threadId,
}: {
  app: AtlasApp
  threadId: ThreadId
}): ServicesControl {
  const read = useCallback((): readonly ServiceSnapshot[] => app.services.list(), [app])
  const [services, setServices] = useState<readonly ServiceSnapshot[]>(read)
  const [state, setState] = useState<ServicesState | null>(null)

  useEffect(() => {
    const update = (): void =>
      setServices((current) => {
        const latest = read()
        return sameServices(current, latest) ? current : latest
      })

    update()
    return app.services.subscribe(update)
  }, [app, read])

  const now = useTickingNow(services.some(isServiceRunning))

  const folded = useMemo(() => foldServices({ services }), [services])
  const declaredControl = useDeclaredServices({ app, threadId })
  const { declared, notice, handleStart, handleRestart, handleStop } = declaredControl

  const rows = useMemo(() => buildServiceRows({ declared, services }), [declared, services])
  const sidebarRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.declared !== undefined ||
          folded.shown.some((one) => one.serviceId === row.snapshot?.serviceId),
      ),
    [folded, rows],
  )
  const declaredRows = rows.filter((row) => row.declared !== undefined)
  const declaredRunning = declaredRows.filter(isRowRunning).length
  const attention = declaredRows.some((row) => rowTone(row) === EServiceTone.Attention)

  const selected = state === null ? undefined : selectedService({ state, rows })

  const [log, setLog] = useState('')
  const openId = selected?.snapshot?.serviceId
  const growing = selected?.snapshot !== undefined && isServiceRunning(selected.snapshot)
  const scroll = useOutputScroll({ resetKey: selected?.key })

  useEffect(() => {
    if (openId === undefined) {
      setLog('')
      return
    }

    let active = true
    let reading = false
    const show = (next: string): void => {
      if (active) setLog((current) => (current === next ? current : next))
    }
    const peek = (): void => {
      if (reading) return
      reading = true
      void Promise.resolve(
        app.services.logTail?.({ serviceId: openId, characters: PEEKED_CHARACTERS }) ?? '',
      )
        .then(show, () => show(''))
        .finally(() => {
          reading = false
        })
    }
    peek()
    if (!growing) {
      return () => {
        active = false
      }
    }
    const timer = setInterval(peek, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [app, growing, openId])

  const handleOpen = useCallback(
    (key?: string) => setState(openServices({ rows, ...(key === undefined ? {} : { key }) })),
    [rows],
  )

  const handleDismiss = useCallback(() => setState(null), [])

  const handleSelect = useCallback((key: string) => setState(selectService({ rows, key })), [rows])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return

      if (key.name === 'escape' || key.name === 'q') {
        handleDismiss()
        return
      }

      const scrolling = outputScrollCommand(key)
      if (scrolling !== null) {
        scroll.handleCommand(scrolling)
        return
      }

      if (key.name === 'up' || key.name === 'down') {
        setState(
          moveServiceSelection({
            state,
            count: rows.length,
            delta: key.name === 'up' ? -1 : 1,
          }),
        )
        return
      }

      const pressed = key.sequence?.toLowerCase() ?? ''
      if (selected === undefined) return

      const actions = rowActions(selected)
      const serviceId = rowServiceId(selected)
      if (pressed === START_KEY && actions.start) handleStart(selected.name)
      if (pressed === RESTART_KEY && actions.restart && serviceId !== undefined) {
        handleRestart(serviceId)
      }
      if (STOP_KEYS.has(pressed) && actions.stop && serviceId !== undefined) handleStop(serviceId)
    },
    [handleDismiss, handleRestart, handleStart, handleStop, rows.length, scroll, selected, state],
  )

  return useMemo(
    () => ({
      services,
      folded: folded.shown,
      fold: { hidden: folded.hidden, hiddenFailed: folded.hiddenFailed },
      everywhere: services,
      rows,
      sidebarRows,
      declaredTotal: declaredRows.length,
      declaredRunning,
      attention,
      notice,
      running: services.filter(isServiceAlive).length,
      now,
      state,
      selected,
      log,
      scroll,
      handleOpen,
      handleDismiss,
      handleSelect,
      handleStart,
      handleRestart,
      handleStop,
      handleKey,
    }),
    [
      attention,
      declaredRows.length,
      declaredRunning,
      folded,
      handleDismiss,
      handleKey,
      handleOpen,
      handleRestart,
      handleSelect,
      handleStart,
      handleStop,
      notice,
      rows,
      sidebarRows,
      log,
      now,
      scroll,
      selected,
      services,
      state,
    ],
  )
}
