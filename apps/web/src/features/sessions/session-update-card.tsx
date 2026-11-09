'use client'

import { CircleAlertIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { ESessionUpdatePhase, useSessionUpdate } from './use-session-update'

export type SessionUpdateCardProps = { skipped: number; writerAhead: boolean }

type Notice = { title: string; detail: string; action: string | undefined; pending: boolean }

const partsOf = (count: number): string => (count === 1 ? '1 part' : `${count} parts`)

const titleOf = (props: SessionUpdateCardProps): string =>
  props.writerAhead
    ? `A newer Atlas wrote ${partsOf(props.skipped)} of this session`
    : `${partsOf(props.skipped)} of this session could not be read`

const noticeOf = (args: {
  phase: ESessionUpdatePhase
  version: string | undefined
  props: SessionUpdateCardProps
}): Notice => {
  const title = titleOf(args.props)
  switch (args.phase) {
    case ESessionUpdatePhase.Web:
      return {
        title,
        detail: 'The rest of the session still works.',
        action: undefined,
        pending: false,
      }
    case ESessionUpdatePhase.Checking:
      return { title, detail: 'Looking for a newer version.', action: 'Checking…', pending: true }
    case ESessionUpdatePhase.Ready:
      return {
        title,
        detail:
          args.version === undefined
            ? 'Restart to finish updating.'
            : `Restart to install ${args.version}.`,
        action: 'Restart to update',
        pending: false,
      }
    case ESessionUpdatePhase.Restarting:
      return { title, detail: 'Atlas is restarting.', action: 'Restarting…', pending: true }
    case ESessionUpdatePhase.Current:
      return {
        title,
        detail: 'No update has been released yet. Try again in a few minutes.',
        action: 'Check again',
        pending: false,
      }
    case ESessionUpdatePhase.Failed:
      return { title, detail: 'The update check failed.', action: 'Try again', pending: false }
  }
}

export function SessionUpdateCard(props: SessionUpdateCardProps) {
  const update = useSessionUpdate()
  const notice = noticeOf({ phase: update.phase, version: update.version, props })
  return (
    <section
      aria-label="Parts of this session this Atlas cannot show"
      className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2"
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{notice.title}</span>
        <span className="break-words text-xs text-muted-foreground">{notice.detail}</span>
      </div>
      {notice.action === undefined ? null : (
        <Button size="sm" variant="outline" disabled={notice.pending} onClick={update.act}>
          {notice.action}
        </Button>
      )}
    </section>
  )
}
