import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useState } from 'react'

import { useOutputScroll, type OutputScroll } from '../ui/hooks/use-output-scroll'
import {
  moveServiceSelection,
  openServices,
  selectedService,
  type ServiceRow,
  type ServicesState,
} from '../ui/services-model'
import { outputScrollCommand } from '../ui/shells-model'

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
}

export function useServicesDrawer(args: { rows: readonly ServiceRow[] }): ServicesDrawer {
  const [state, setState] = useState<ServicesState | null>(null)
  const { rows } = args

  const selected = state === null ? undefined : selectedService({ state, rows })
  const scroll = useOutputScroll({ resetKey: selected?.key })

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
      }
    },
    [handleDismiss, rows.length, scroll, state],
  )

  return useMemo(
    () => ({
      open: state !== null,
      rows,
      selected,
      log: '',
      notice: null,
      scroll,
      handleOpen,
      handleDismiss,
      handleKey,
    }),
    [handleDismiss, handleKey, handleOpen, rows, scroll, selected, state],
  )
}
