'use client'

import type { ReactNode } from 'react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

const SKELETON_ROWS = ['one', 'two', 'three']

export function LoadingBlocks({ label }: { label: string }) {
  return (
    <div role="status" aria-label={`Loading ${label}`} className="flex flex-col gap-3">
      {SKELETON_ROWS.map((row) => (
        <Skeleton key={row} className="h-14 w-full rounded-lg" />
      ))}
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
  wrap = keep,
  children,
}: {
  query: CloudQuery<TData>
  label: string
  wrap?: (content: ReactNode) => ReactNode
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Ready) return <>{children(query.data)}</>
  if (query.state === EQueryState.Failed) {
    return (
      <>{wrap(<LoadFailed label={label} message={query.error.message} onRetry={query.reload} />)}</>
    )
  }
  return <>{wrap(<LoadingBlocks label={label} />)}</>
}
