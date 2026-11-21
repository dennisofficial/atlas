'use client'

import { useState } from 'react'

import type { PodBusy } from '@dltech/atlas-core'
import type { PodShape } from '@dltech/atlas-ui/ai/pod-section'
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

export type ResizeRequest = {
  vcpus: number
  whenIdle: boolean
}

export type PodShapeRequest = {
  shape: PodShape
  whenIdle: boolean
}

type Confirmation = {
  running: readonly string[]
  canWait: boolean
  wait: () => void
  force: () => void
  decline: () => void
}

function useBusyConfirmation<S>(args: {
  busy: PodBusy
  canWait: boolean
  apply: (size: S, whenIdle: boolean) => Promise<void>
}) {
  const { busy, canWait, apply } = args
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const askFirst = (size: S) =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (whenIdle: boolean) => {
        if (settled) return
        settled = true
        setConfirmation(null)
        apply(size, whenIdle).then(resolve, reject)
      }
      setConfirmation({
        running: busy.running,
        canWait,
        wait: () => settle(true),
        force: () => settle(false),
        decline: () => {
          if (settled) return
          settled = true
          setConfirmation(null)
          reject(new ResizeDeclinedError())
        },
      })
    })

  const confirm = (size: S) => (busy.busy ? askFirst(size) : apply(size, false))

  return { confirmation, confirm }
}

export function useResizeConfirmation(args: {
  busy: PodBusy
  onResize: (request: ResizeRequest) => Promise<void>
  canWait?: boolean
}) {
  const { busy, onResize, canWait = true } = args
  const { confirmation, confirm } = useBusyConfirmation<number>({
    busy,
    canWait,
    apply: (vcpus, whenIdle) => onResize({ vcpus, whenIdle }),
  })
  return { confirmation, handleResize: confirm }
}

export function useShapeResizeConfirmation(args: {
  busy: PodBusy
  onResize: (request: PodShapeRequest) => Promise<void>
  canWait?: boolean
}) {
  const { busy, onResize, canWait = true } = args
  const { confirmation, confirm } = useBusyConfirmation<PodShape>({
    busy,
    canWait,
    apply: (shape, whenIdle) => onResize({ shape, whenIdle }),
  })
  return { confirmation, handleResize: confirm }
}

export function ResizeBusyDialog({
  confirmation,
  body = POD_RESTART_BODY,
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
          <AlertDialogTitle>Resize a pod that is working?</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation === null || confirmation.running.length === 0
              ? body
              : `${confirmation.running.join(', ')} running. ${body}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {confirmation?.canWait === false ? null : (
            <AlertDialogAction variant="outline" onClick={() => confirmation?.wait()}>
              Wait until idle
            </AlertDialogAction>
          )}
          <AlertDialogAction onClick={() => confirmation?.force()}>Force restart</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
