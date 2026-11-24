import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import { useOutputScroll, type OutputScroll } from '../ui/hooks/use-output-scroll'
import {
  moveServiceSelection,
  openServices,
  rowServiceId,
  selectedService,
  type ServiceRow,
  type ServicesState,
} from '../ui/services-model'
import { outputScrollCommand } from '../ui/shells-model'
import type { SessionApi } from './session-api'
import { useServiceLog, serviceLogText } from './use-service-log'

export type ServicesDrawer = {
  open: boolean
  rows: readonly ServiceRow[]
  selected: ServiceRow | undefined
  log: string
  notice: string | null
  scroll: OutputScroll
  handleOpen: (key?: string) => void
  handleDismiss: () => void
  handleKey: (key: KeyEvent) => void
  onStop: (serviceId: string) => void
  onRestart: (serviceId: string) => void
}

export function useServicesDrawer(args: {
  rows: readonly ServiceRow[]
  api: SessionApi
  sessionId: string
  headSeq: number
  onStop: (serviceId: string) => void
  onRestart: (serviceId: string) => void
}): ServicesDrawer {
  const [state, setState] = useState<ServicesState | null>(null)
  const { rows } = args

  const selected = state === null ? undefined : selectedService({ state, rows })
  const serviceId = selected === undefined ? undefined : rowServiceId(selected)
  const scroll = useOutputScroll({ resetKey: selected?.key })
  const serviceLog = useServiceLog({
    api: args.api,
    sessionId: args.sessionId,
    serviceId,
    headSeq: args.headSeq,
  })

  const handleOpen = useCallback(
    (key?: string) => setState(openServices({ rows, ...(key === undefined ? {} : { key }) })),
    [rows],
  )

  const handleDismiss = useCallback(() => setState(null), [])

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

      const target = rows[state.index]
      const targetId = target === undefined ? undefined : rowServiceId(target)
      if (targetId === undefined) return
      if (key.name === 's') args.onStop(targetId)
      if (key.name === 'r') args.onRestart(targetId)
    },
    [args, handleDismiss, rows, scroll, state],
  )

  return useMemo(
    () => ({
      open: state !== null,
      rows,
      selected,
      log: serviceLogText(serviceLog),
      notice: null,
      scroll,
      handleOpen,
      handleDismiss,
      handleKey,
      onStop: args.onStop,
      onRestart: args.onRestart,
    }),
    [args, handleDismiss, handleKey, handleOpen, rows, scroll, selected, serviceLog, state],
  )
}
