'use client'

import { CircleAlertIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { ESessionUpdatePhase, useSessionUpdate } from './use-session-update'

type Notice = { detail: string; action: string; pending: boolean }

const noticeOf = (args: { phase: ESessionUpdatePhase; version: string | undefined }): Notice => {
  switch (args.phase) {
    case ESessionUpdatePhase.Web:
      return { detail: 'Reload to see everything in it.', action: 'Reload', pending: false }
    case ESessionUpdatePhase.Checking:
      return { detail: 'Looking for a newer version.', action: 'Checking…', pending: true }
    case ESessionUpdatePhase.Ready:
      return {
        detail:
          args.version === undefined
            ? 'Restart to finish updating.'
            : `Restart to install ${args.version}.`,
        action: 'Restart to update',
        pending: false,
      }
    case ESessionUpdatePhase.Restarting:
      return { detail: 'Atlas is restarting.', action: 'Restarting…', pending: true }
    case ESessionUpdatePhase.Current:
      return {
        detail: 'No update has been released yet. Try again in a few minutes.',
        action: 'Check again',
        pending: false,
      }
    case ESessionUpdatePhase.Failed:
      return { detail: 'The update check failed.', action: 'Try again', pending: false }
  }
}

export function SessionUpdateCard() {
  const update = useSessionUpdate()
  const notice = noticeOf({ phase: update.phase, version: update.version })
  return (
    <section
      aria-label="Session needs a newer Atlas"
      className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">A newer Atlas wrote this session</span>
        <span className="break-words text-xs text-muted-foreground">{notice.detail}</span>
      </div>
      <Button size="sm" variant="outline" disabled={notice.pending} onClick={update.act}>
        {notice.action}
      </Button>
    </section>
  )
}
