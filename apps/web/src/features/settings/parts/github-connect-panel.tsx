'use client'

import { AlertCircleIcon } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { openBrowserReturn } from '@/features/auth/browser-return/open-browser-return'
import { EGithubFlow, type GithubFlow } from '../data/personal/use-github-connect'

export function GithubConnectPanel({
  flow,
  onCancel,
  onRetry,
}: {
  flow: GithubFlow
  onCancel: () => void
  onRetry: () => void
}) {
  if (flow.status === EGithubFlow.Idle) return null
  if (flow.status === EGithubFlow.Starting)
    return (
      <p className="flex items-center gap-2 pl-12 text-sm text-muted-foreground">
        <Spinner /> Opening GitHub
      </p>
    )
  if (flow.status === EGithubFlow.Failed)
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>GitHub didn&apos;t connect</AlertTitle>
        <AlertDescription>{flow.message}</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </AlertAction>
      </Alert>
    )
  const handleOpen = () => openBrowserReturn({ url: flow.url })
  return (
    <div className="flex flex-col gap-3 pl-12" role="status">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Waiting for GitHub. Approve Atlas in your browser.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="xs" onClick={handleOpen}>
          Open GitHub
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
