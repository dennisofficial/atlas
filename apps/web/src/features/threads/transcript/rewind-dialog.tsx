'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dltech/atlas-ui/components/alert-dialog'
import { Badge } from '@dltech/atlas-ui/components/badge'

import type { RewindKillRow } from '../data/rewind'

export const REWIND_DIALOG_DESCRIPTION =
  'Rewinding stops everything started after this message. Files are left as they are.'

export function RewindKillList({ kills }: { kills: readonly RewindKillRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {kills.map((row, index) => (
        <li
          key={`${row.kind}:${row.label}:${index}`}
          className="flex min-w-0 items-center gap-2 text-sm"
        >
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.kind}</span>
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.running ? <Badge variant="destructive">Running</Badge> : null}
        </li>
      ))}
    </ul>
  )
}

export function RewindDialogActions(props: {
  applying: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <>
      <AlertDialogAction variant="outline" onClick={props.onCancel}>
        Cancel
      </AlertDialogAction>
      <AlertDialogAction variant="destructive" disabled={props.applying} onClick={props.onConfirm}>
        Rewind
      </AlertDialogAction>
    </>
  )
}

export function RewindDialog(props: {
  pick: { toSeq: number; kills: readonly RewindKillRow[] } | null
  applying: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { pick, applying, onCancel, onConfirm } = props
  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel()
  }
  return (
    <AlertDialog open={pick !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rewind to this message?</AlertDialogTitle>
          <AlertDialogDescription>{REWIND_DIALOG_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        <RewindKillList kills={pick?.kills ?? []} />
        <AlertDialogFooter>
          <RewindDialogActions applying={applying} onCancel={onCancel} onConfirm={onConfirm} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
