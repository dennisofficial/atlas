'use client'

import type { ReactNode } from 'react'
import { AlertCircleIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

import type { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { SettingsPage, SettingsSection } from '../../settings-layout'
import { LoadingRegion } from '../shared/query-gate'

const PAGE_BODY_CLASS = 'flex flex-col gap-8'

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

export function QueryBody<TData>({
  query,
  label,
  skeleton,
  className,
  children,
}: {
  query: CloudQuery<TData>
  label: string
  skeleton: ReactNode
  className?: string
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Loading) {
    return (
      <LoadingRegion label={label} {...(className === undefined ? {} : { className })}>
        {skeleton}
      </LoadingRegion>
    )
  }
  if (query.state === EQueryState.Failed) {
    return <QueryFailure error={query.error} onRetry={query.reload} />
  }
  return <>{children(query.data)}</>
}

export function QueryPage<TData>({
  query,
  title,
  description,
  actions,
  skeleton,
  children,
}: {
  query: CloudQuery<TData>
  title: string
  description?: ReactNode
  actions?: ReactNode
  skeleton: ReactNode
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Ready) return <>{children(query.data)}</>
  return (
    <SettingsPage
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
    >
      <QueryBody query={query} label={title} skeleton={skeleton} className={PAGE_BODY_CLASS}>
        {children}
      </QueryBody>
    </SettingsPage>
  )
}

export function QuerySection<TData>({
  query,
  title,
  description,
  actions,
  skeleton,
  children,
}: {
  query: CloudQuery<TData>
  title: string
  description?: ReactNode
  actions?: ReactNode
  skeleton: ReactNode
  children: (data: TData) => ReactNode
}) {
  if (query.state === EQueryState.Ready) return <>{children(query.data)}</>
  return (
    <SettingsSection
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
    >
      <QueryBody query={query} label={title} skeleton={skeleton}>
        {children}
      </QueryBody>
    </SettingsSection>
  )
}
