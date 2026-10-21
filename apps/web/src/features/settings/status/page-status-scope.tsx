'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { PageStatusCard } from './page-status-card'
import type { EPageStatus } from './page-status'

type DismissedValue = {
  dismissed: ReadonlySet<string>
  dismiss: (key: string) => void
}

type CurrentValue = { key: string; status: EPageStatus; detail?: string }

const DismissedContext = createContext<DismissedValue | null>(null)
const CurrentContext = createContext<CurrentValue | null>(null)

export function PageStatusProvider({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const dismiss = useCallback(
    (key: string) => setDismissed((current) => new Set(current).add(key)),
    [],
  )
  const value = useMemo(() => ({ dismissed, dismiss }), [dismissed, dismiss])
  return <DismissedContext.Provider value={value}>{children}</DismissedContext.Provider>
}

export function PageStatusScope({
  pageKey,
  status,
  detail,
  children,
}: {
  pageKey: string
  status: EPageStatus
  detail?: string
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ key: pageKey, status, ...(detail === undefined ? {} : { detail }) }),
    [pageKey, status, detail],
  )
  return <CurrentContext.Provider value={value}>{children}</CurrentContext.Provider>
}

export function PageStatusSlot() {
  const current = useContext(CurrentContext)
  const store = useContext(DismissedContext)
  if (!current) return null
  if (store?.dismissed.has(current.key)) return null
  const handleDismiss = store ? () => store.dismiss(current.key) : undefined
  return (
    <PageStatusCard
      status={current.status}
      {...(current.detail === undefined ? {} : { detail: current.detail })}
      {...(handleDismiss === undefined ? {} : { onDismiss: handleDismiss })}
    />
  )
}
