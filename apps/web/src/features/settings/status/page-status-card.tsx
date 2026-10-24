'use client'

import { CloudCheckIcon, EyeIcon, SplitIcon, XIcon, type LucideIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

import { EPageStatus } from './page-status'

type StatusCopy = { title: string; body: string; icon: LucideIcon }

const STATUS_COPY: Record<Exclude<EPageStatus, EPageStatus.Live>, StatusCopy> = {
  [EPageStatus.Mock]: {
    title: 'Preview only',
    body: "This page shows sample data. Changes aren't saved and aren't hooked up to Atlas Cloud yet.",
    icon: EyeIcon,
  },
  [EPageStatus.Stored]: {
    title: 'Saved to Atlas Cloud',
    body: "Changes persist to your account, but the cloud harness doesn't read this setting yet.",
    icon: CloudCheckIcon,
  },
  [EPageStatus.Partial]: {
    title: 'Partly connected',
    body: 'Some of this page is saved to Atlas Cloud; the rest still shows sample data.',
    icon: SplitIcon,
  },
}

export function PageStatusCard({
  status,
  detail,
  onDismiss,
}: {
  status: EPageStatus
  detail?: string
  onDismiss?: () => void
}) {
  if (status === EPageStatus.Live) return null
  const { title, body, icon: Icon } = STATUS_COPY[status]
  return (
    <Alert role="status" data-status={status}>
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {body}
        {detail ? <span className="mt-1 block">{detail}</span> : null}
      </AlertDescription>
      {onDismiss ? (
        <AlertAction>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
            <XIcon />
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}
