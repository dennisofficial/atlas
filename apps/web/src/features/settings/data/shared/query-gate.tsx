'use client'

import type { ReactNode } from 'react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div role="status" aria-busy="true" aria-label={`Loading ${label}`} className={className}>
      {children}
    </div>
  )
}

export function LoadFailed({
  label,
  message,
  onRetry,
}: {
  label: string
  message: string
  onRetry: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Couldn&apos;t load {label}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  )
}

const keep = (content: ReactNode): ReactNode => content

export function QueryGate<TData>({
  query,
  label,
  skeleton,
  className,
  wrap = keep,
  children,
}: {
  query: CloudQuery<TData>
  label: string
  skeleton: ReactNode
  className?: string
  wrap?: (content: ReactNode) => ReactNode
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Ready) return <>{children(query.data)}</>
  if (query.state === EQueryState.Failed) {
    return (
      <>{wrap(<LoadFailed label={label} message={query.error.message} onRetry={query.reload} />)}</>
    )
  }
  return (
    <>
      {wrap(
        <LoadingRegion label={label} {...(className === undefined ? {} : { className })}>
          {skeleton}
        </LoadingRegion>,
      )}
    </>
  )
}
