import type { ReactNode } from 'react'
import { CircleAlertIcon, RotateCcwIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '#components/alert'
import { Button, buttonVariants } from '#components/button'

export interface RunFailureLinkRenderArgs {
  href: string
  className: string
  children: ReactNode
}

export interface RunFailureBannerProps {
  title: string
  detail: string
  settingsHref?: string
  settingsLabel?: string
  renderLink?: (args: RunFailureLinkRenderArgs) => ReactNode
  onRetry?: () => void
  retryDisabled?: boolean
}

const LINK_CLASS = buttonVariants({ variant: 'default', size: 'sm' })

export function RunFailureBanner({
  title,
  detail,
  settingsHref,
  settingsLabel = 'Open settings',
  renderLink,
  onRetry,
  retryDisabled = false,
}: RunFailureBannerProps) {
  const link =
    settingsHref === undefined
      ? null
      : (renderLink ?? defaultLink)({
          href: settingsHref,
          className: LINK_CLASS,
          children: settingsLabel,
        })
  const hasActions = link !== null || onRetry !== undefined
  return (
    <Alert variant="destructive" data-slot="run-failure-banner">
      <CircleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
      {hasActions ? (
        <div className="col-start-2 mt-2 flex flex-wrap items-center gap-2">
          {link}
          {onRetry === undefined ? null : (
            <Button variant="outline" size="sm" disabled={retryDisabled} onClick={onRetry}>
              <RotateCcwIcon data-icon="inline-start" />
              Retry
            </Button>
          )}
        </div>
      ) : null}
    </Alert>
  )
}

function defaultLink({ href, className, children }: RunFailureLinkRenderArgs): ReactNode {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  )
}
