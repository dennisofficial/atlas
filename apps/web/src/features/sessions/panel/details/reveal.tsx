'use client'

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

const REVEAL_MS = 200
const RevealSettled = createContext(false)

export function DetailsMotion({ children }: { children: ReactNode }) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [])
  return <RevealSettled.Provider value={settled}>{children}</RevealSettled.Provider>
}

export function Reveal(props: {
  open: boolean
  children: ReactNode
  section?: boolean
  onExited?: () => void
}) {
  const settled = useContext(RevealSettled)
  const [shown, setShown] = useState(props.open && !settled)
  const [held, setHeld] = useState(props.children)
  const [mounted, setMounted] = useState(props.open)

  if (props.open && held !== props.children) setHeld(props.children)

  useEffect(() => {
    if (!settled) {
      setShown(props.open)
      setMounted(props.open)
      if (!props.open) {
        props.onExited?.()
      }
      return
    }
    if (props.open) {
      setMounted(true)
      const frame = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(frame)
    }
    setShown(false)
    const timer = setTimeout(
      () => {
        setMounted(false)
        props.onExited?.()
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : REVEAL_MS,
    )
    return () => clearTimeout(timer)
  }, [props.open, settled, props.onExited])

  if (!props.open && !mounted) return null
  return (
    <div
      data-details-reveal
      data-open={shown || undefined}
      inert={!props.open}
      className={cn(
        'grid shrink-0 grid-rows-[0fr] opacity-0 data-open:grid-rows-[1fr] data-open:opacity-100',
        settled &&
          'transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
      )}
    >
      <div className="-mx-1.5 min-h-0 overflow-hidden px-1.5">
        <div className={cn(props.section && 'in-data-[session-details]:pt-5')}>
          {props.open ? props.children : held}
        </div>
      </div>
    </div>
  )
}

type RevealedRow<T> = { key: string | number; row: T; open: boolean }

export function RetainedRows<T>(props: {
  rows: readonly T[]
  rowKey: (row: T) => string | number
  render: (entry: { row: T; open: boolean; onExited: () => void }) => ReactNode
}) {
  const [held, setHeld] = useState(props.rows)
  const [rows, setRows] = useState<RevealedRow<T>[]>(() =>
    props.rows.map((row) => ({ key: props.rowKey(row), row, open: true })),
  )
  if (held !== props.rows) {
    const next = props.rows.map((row) => ({ key: props.rowKey(row), row, open: true }))
    for (const previous of rows) {
      if (next.some((row) => row.key === previous.key)) continue
      next.splice(rows.indexOf(previous), 0, { ...previous, open: false })
    }
    setHeld(props.rows)
    setRows(next)
  }
  return rows.map((entry) => (
    <Fragment key={entry.key}>
      {props.render({
        row: entry.row,
        open: entry.open,
        onExited: () =>
          setRows((current) => current.filter((row) => row.key !== entry.key || row.open)),
      })}
    </Fragment>
  ))
}

export function RevealRows<T>(props: {
  rows: readonly T[]
  rowKey: (row: T) => string | number
  render: (row: T) => ReactNode
}) {
  return (
    <RetainedRows
      rows={props.rows}
      rowKey={props.rowKey}
      render={({ row, open, onExited }) => (
        <Reveal open={open} onExited={onExited}>
          {props.render(row)}
        </Reveal>
      )}
    />
  )
}
