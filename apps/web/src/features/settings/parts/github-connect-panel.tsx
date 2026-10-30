'use client'

import { useState } from 'react'
import { AlertCircleIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { EGithubFlow, type GithubFlow } from '../data/personal/use-github-connect'
import { Mono } from '../settings-layout'

const COPIED_FLASH_MS = 1600

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_FLASH_MS)
  }
  return (
    <Button variant="outline" size="xs" onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : 'Copy code'}
    </Button>
  )
}

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

  if (flow.status === EGithubFlow.Starting) {
    return (
      <p className="flex items-center gap-2 pl-12 text-sm text-muted-foreground">
        <Spinner /> Requesting a code
      </p>
    )
  }

  if (flow.status === EGithubFlow.Failed) {
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
  }

  const { userCode, verificationUrl } = flow.codes
  return (
    <div className="flex flex-col gap-3 pl-12" role="status">
      <p className="text-sm text-muted-foreground">Enter this code on GitHub to approve Atlas.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Mono className="text-lg font-semibold tracking-widest">{userCode}</Mono>
        <CopyCodeButton code={userCode} />
        <Button
          variant="outline"
          size="xs"
          nativeButton={false}
          render={<a href={verificationUrl} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
          Open GitHub
        </Button>
        <Button variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> Waiting for approval
      </p>
    </div>
  )
}
