'use client'

import { CircleAlertIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

export function StartFailedCard({
  reason,
  onRetry,
}: {
  reason: string | undefined
  onRetry: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)

  const handleRetry = async () => {
    if (pending) return
    setPending(true)
    try {
      await onRetry()
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      aria-label="Start failed"
      className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">Atlas couldn&apos;t start this session</span>
        {reason === undefined ? null : (
          <span className="break-words text-xs text-muted-foreground">{reason}</span>
        )}
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void handleRetry()}>
        Retry
      </Button>
    </section>
  )
}
