import type { KeyEvent } from '@opentui/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import { EEffort, type ModelRef } from '@dltech/atlas-core'
import type { CatalogueProvider } from '@dltech/atlas-models'
import type { SessionModelChoice } from '@dltech/atlas-protocol'

import {
  anchorOn,
  adjustEffort,
  modelCount,
  moveSelection,
  resolve,
  selectAt,
  selectedCard,
  ESwitcherRow,
  switcherRows,
  toggleFast,
  type SwitcherChoice,
  type SwitcherRow,
  type SwitcherState,
} from '../ui/switcher-model'
import { choiceOfModel } from './model-set'

export type ModelChoiceControl = {
  state: SwitcherState | null
  rows: readonly SwitcherRow[]
  query: string
  total: number
  active: ModelRef
  handleOpen: () => void
  handlePick: (choice: SwitcherChoice) => void
  handleDismiss: () => void
  handleSelect: (index: number) => void
  handleQuery: (typed: string) => void
  handleKey: (key: KeyEvent) => boolean
}

type Browsing = { state: SwitcherState; query: string }

type Anchor = { ref: ModelRef | undefined; effort: EEffort; fast: boolean }

const anchorOf = (active: SessionModelChoice | null): Anchor => {
  if (active === null) return { ref: undefined, effort: EEffort.Medium, fast: false }
  const choice = choiceOfModel({ model: active })
  return { ref: choice.ref ?? undefined, effort: choice.effort, fast: choice.fast }
}

export function useModelChoice(args: {
  catalogue: readonly CatalogueProvider[]
  reachable: ReadonlySet<string>
  active: SessionModelChoice | null
  onPick: (choice: SwitcherChoice) => void
}): ModelChoiceControl {
  const held = useRef<Browsing | null>(null)
  const [browsing, setBrowsing] = useState<Browsing | null>(null)
  const { catalogue, reachable, active, onPick } = args

  const put = useCallback((next: Browsing | null) => {
    held.current = next
    setBrowsing(next)
  }, [])

  const rowsFor = useCallback(
    (query: string) => switcherRows({ providers: catalogue, availability: reachable, query }),
    [catalogue, reachable],
  )

  const query = browsing?.query ?? ''
  const rows = useMemo(() => rowsFor(query), [query, rowsFor])
  const total = useMemo(() => modelCount(catalogue), [catalogue])

  const handleOpen = useCallback(() => {
    const anchor = anchorOf(active)
    put({
      query: '',
      state: anchorOn({
        rows: rowsFor(''),
        active: anchor.ref,
        effort: anchor.effort,
        fast: anchor.fast,
      }),
    })
  }, [active, put, rowsFor])

  const handleDismiss = useCallback(() => put(null), [put])

  const handlePick = useCallback(
    (choice: SwitcherChoice) => {
      put(null)
      onPick(choice)
    },
    [onPick, put],
  )

  const handleQuery = useCallback(
    (typed: string) => {
      const current = held.current
      if (current === null) return

      const following = selectedCard({ state: current.state, rows: rowsFor(current.query) })?.ref
      put({
        ...current,
        query: typed,
        state: anchorOn({
          rows: rowsFor(typed),
          active: following,
          effort: current.state.effort,
          fast: current.state.fast,
        }),
      })
    },
    [put, rowsFor],
  )

  const handleSelect = useCallback(
    (index: number) => {
      const current = held.current
      if (current === null) return

      put({
        ...current,
        state: selectAt({ state: current.state, index, rows: rowsFor(current.query) }),
      })
    },
    [put, rowsFor],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      const current = held.current
      if (current === null) return false

      const laid = rowsFor(current.query)

      if (key.name === 'escape') {
        key.preventDefault()
        handleDismiss()
        return true
      }

      if (key.name === 'return') {
        key.preventDefault()
        handlePick(resolve({ state: current.state, rows: laid }))
        return true
      }

      if (key.name === 'up' || key.name === 'down') {
        key.preventDefault()
        const delta = key.name === 'up' ? -1 : 1
        put({ ...current, state: moveSelection({ state: current.state, delta, rows: laid }) })
        return true
      }

      if (key.name === 'left' || key.name === 'right') {
        key.preventDefault()
        const delta = key.name === 'left' ? -1 : 1
        put({ ...current, state: adjustEffort({ state: current.state, delta, rows: laid }) })
        return true
      }

      if (key.name === 'tab') {
        key.preventDefault()
        put({ ...current, state: toggleFast({ state: current.state, rows: laid }) })
        return true
      }

      return false
    },
    [handleDismiss, handlePick, put, rowsFor],
  )

  const activeRef = useMemo((): ModelRef => {
    const anchor = anchorOf(active)
    if (anchor.ref !== undefined) return anchor.ref
    const first = rows.find((row) => row.kind === ESwitcherRow.Model)
    return first?.kind === ESwitcherRow.Model ? first.card.ref : { providerId: '', modelId: '' }
  }, [active, rows])

  return useMemo(
    () => ({
      state: browsing?.state ?? null,
      rows,
      query,
      total,
      active: activeRef,
      handleOpen,
      handlePick,
      handleDismiss,
      handleSelect,
      handleQuery,
      handleKey,
    }),
    [
      activeRef,
      browsing,
      handleDismiss,
      handleKey,
      handleOpen,
      handlePick,
      handleQuery,
      handleSelect,
      put,
      query,
      rows,
      total,
    ],
  )
}
