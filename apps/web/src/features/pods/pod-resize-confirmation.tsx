'use client'

import { useState } from 'react'

import { ResizeDeclinedError } from '@dltech/atlas-ui/ai/pod-status-chip'
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

export const TURN_RESTART_BODY = 'The current turn stops and running processes end. Files are kept.'

export const POD_RESTART_BODY =
  'Running shells and services stop while the sandbox restarts. Files are kept and the agent keeps working.'

type Confirmation = {
  accept: () => void
  decline: () => void
}

export function useResizeConfirmation(args: {
  busy: boolean
  onResize: (vcpus: number) => Promise<void>
}) {
  const { busy, onResize } = args
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

  return { confirmation, handleResize: busy ? askFirst : onResize }
}

export function RestartConfirmDialog({
  confirmation,
  body = TURN_RESTART_BODY,
}: {
  confirmation: Confirmation | null
  body?: string
}) {
  const handleOpenChange = (open: boolean) => {
    if (!open) confirmation?.decline()
  }

  return (
    <AlertDialog open={confirmation !== null} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restart the sandbox now?</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep working</AlertDialogCancel>
          <AlertDialogAction onClick={() => confirmation?.accept()}>Restart</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
