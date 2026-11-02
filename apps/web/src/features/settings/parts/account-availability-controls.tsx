'use client'

import { useState } from 'react'
import { LoaderCircleIcon } from 'lucide-react'

import {
  EAccountAccess,
  EControlOutcomeTone,
  pauseConfirmationOf,
} from '@dltech/atlas-client/transcript'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'

import type { AccountAvailabilityView } from '../data/personal/use-account-availability'

export function AccountAvailabilityControls({
  accountLabel,
  view,
}: {
  accountLabel: string
  view: AccountAvailabilityView
}) {
  const [confirming, setConfirming] = useState(false)
  const { access, pending, note, onPause, onRemovePause } = view
  const confirmation = pauseConfirmationOf({ accountLabel, affected: access.affected })
  const failed = note?.tone === EControlOutcomeTone.Error
  return (
    <div className="flex flex-col gap-2" data-slot="account-availability">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Connected</Badge>
        {access.label === null ? null : (
          <Badge variant={access.access === EAccountAccess.Paused ? 'secondary' : 'destructive'}>
            {access.label}
          </Badge>
        )}
        {onPause === null ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`Pause ${accountLabel}`}
            onClick={() => setConfirming(true)}
          >
            Pause
          </Button>
        )}
        {onRemovePause === null ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={`Remove manual pause on ${accountLabel}`}
            onClick={onRemovePause}
          >
            Remove manual pause
          </Button>
        )}
        {pending ? (
          <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />
            Updating…
          </span>
        ) : null}
      </div>
      {note === null ? null : (
        <p
          role={failed ? 'alert' : 'status'}
          className={failed ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {note.text}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false)
                onPause?.()
              }}
            >
              {confirmation.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
