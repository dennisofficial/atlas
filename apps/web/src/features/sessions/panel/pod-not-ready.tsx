'use client'

import { PlugZapIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

export function PodNotReady(props: { tab: string; onRetry: () => void }) {
  const handleRetry = () => props.onRetry()
  return (
    <div
      data-pod-not-ready
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <PlugZapIcon className="text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Pod not ready</p>
        <p className="text-xs text-muted-foreground">
          {props.tab} live in the pod, and no host has picked it up yet
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={handleRetry}>
        Try again
      </Button>
    </div>
  )
}
