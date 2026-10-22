'use client'

import type { ReactNode } from 'react'
import { AlertCircleIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import type { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { SettingsCard, SettingsPage, SettingsSection } from '../../settings-layout'

const DEFAULT_ROWS = 3

export function QueryFailure({ error, onRetry }: { error: CloudApiError; onRetry: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircleIcon />
      <AlertTitle>Couldn&apos;t load this</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  )
}

export function QueryLoading({ rows = DEFAULT_ROWS }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <SettingsCard>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="size-8 shrink-0" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </SettingsCard>
    </div>
  )
}

export function QueryBody<TData>({
  query,
  rows,
  children,
}: {
  query: CloudQuery<TData>
  rows?: number
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Loading)
    return <QueryLoading {...(rows === undefined ? {} : { rows })} />
  if (query.state === EQueryState.Failed) {
    return <QueryFailure error={query.error} onRetry={query.reload} />
  }
  return <>{children(query.data)}</>
}

export function QueryPage<TData>({
  query,
  title,
  description,
  rows,
  children,
}: {
  query: CloudQuery<TData>
  title: string
  description?: ReactNode
  rows?: number
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Ready) return <>{children(query.data)}</>
  return (
    <SettingsPage title={title} {...(description === undefined ? {} : { description })}>
      <QueryBody query={query} {...(rows === undefined ? {} : { rows })}>
        {children}
      </QueryBody>
    </SettingsPage>
  )
}

export function QuerySection<TData>({
  query,
  title,
  description,
  rows,
  children,
}: {
  query: CloudQuery<TData>
  title: string
  description?: ReactNode
  rows?: number
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Ready) return <>{children(query.data)}</>
  return (
    <SettingsSection title={title} {...(description === undefined ? {} : { description })}>
      <QueryBody query={query} {...(rows === undefined ? {} : { rows })}>
        {children}
      </QueryBody>
    </SettingsSection>
  )
}
