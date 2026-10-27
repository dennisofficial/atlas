'use client'

import { useState } from 'react'

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
import { PodStatusChip, ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'
import type { PodStatus } from '@dltech/atlas-wire/web'

import { chipStatusOf } from './data/pod-chip-model'

type Confirmation = {
  accept: () => void
  decline: () => void
}

export function useResizeConfirmation(args: {
  working: boolean
  onResize: (vcpus: number) => Promise<void>
}) {
  const { working, onResize } = args
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const askFirst = (vcpus: number) =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      setConfirmation({
        accept: () => {
          if (settled) return
          settled = true
          setConfirmation(null)
          onResize(vcpus).then(resolve, reject)
        },
        decline: () => {
          if (settled) return
          settled = true
          setConfirmation(null)
          reject(new ResizeDeclinedError())
        },
      })
    })

  return { confirmation, handleResize: working ? askFirst : onResize }
}

export function RestartConfirmDialog({ confirmation }: { confirmation: Confirmation | null }) {
  const handleOpenChange = (open: boolean) => {
    if (!open) confirmation?.decline()
  }

  return (
    <AlertDialog open={confirmation !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restart the sandbox now?</AlertDialogTitle>
          <AlertDialogDescription>
            The current turn stops and running processes end. Files are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep working</AlertDialogCancel>
          <AlertDialogAction onClick={() => confirmation?.accept()}>Restart</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type ThreadPodChipProps = {
  pod: PodStatus | null
  working: boolean
  onResize: (vcpus: number) => Promise<void>
  settingsHref?: string | undefined
}

export function ThreadPodChip({ pod, working, onResize, settingsHref }: ThreadPodChipProps) {
  const { confirmation, handleResize } = useResizeConfirmation({ working, onResize })
  const status = chipStatusOf(pod)
  if (status === null) return null

  return (
    <>
      <PodStatusChip status={status} onResize={handleResize} settingsHref={settingsHref} />
      <RestartConfirmDialog confirmation={confirmation} />
    </>
  )
}
