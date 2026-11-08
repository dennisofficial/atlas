'use client'

import type { SummariseReach } from '@dltech/atlas-core'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dltech/atlas-ui/components/alert-dialog'

import { summariseCopyOf, type SummariseCopy } from '../data/summarise'

export function SummariseDialog(props: {
  pick: SummariseReach | null
  onCancel: () => void
  onConfirm: () => void
  copyOf?: (pick: SummariseReach) => SummariseCopy
}) {
  const { pick, onCancel, onConfirm, copyOf = summariseCopyOf } = props
  const copy = pick === null ? null : copyOf(pick)
  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel()
  }
  return (
    <AlertDialog open={pick !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction variant="outline" onClick={onCancel}>
            Cancel
          </AlertDialogAction>
          <AlertDialogAction onClick={onConfirm}>Summarise</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
