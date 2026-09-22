import type { KeyEvent } from '@opentui/core'
import { CLOUD_PURGE_DOMAINS, type CloudPurgeResult, type CloudService } from '@dltech/atlas-harness'
import { useCallback, useMemo, useState } from 'react'

import { ENoticeTone, notify } from '../ui/notice-store'
import {
  openPurgeConfirm,
  runningPurgeConfirm,
  type PurgeConfirmState,
} from '../ui/purge-confirm-model'

export type PurgeConfirmControl = {
  state: PurgeConfirmState | null
  handleOpen: () => void
  handleDismiss: () => void
  handleConfirm: () => void
  handleKey: (key: KeyEvent) => void
}

export const purgedNotice = (result: CloudPurgeResult): string => {
  const moved: string[] = []
  for (const domain of CLOUD_PURGE_DOMAINS) {
    if (domain.count === undefined) continue
    const count = domain.count(result)
    if (count > 0) moved.push(domain.movedLabel(count))
  }
  if (moved.length === 0) return 'The cloud held nothing of yours to move — you are signed out.'
  const list = moved.length === 1 ? moved[0] : `${moved.slice(0, -1).join(', ')} and ${moved.at(-1)}`
  return `Moved ${list} to this machine, deleted them from the cloud, and signed you out.`
}

const failureNotice = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'The purge failed — whatever did not land is still in the cloud, safe to retry.'

export function usePurgeConfirm(args: {
  cloud: CloudService
  onSettled: () => void
}): PurgeConfirmControl {
  const { cloud, onSettled } = args
  const [state, setState] = useState<PurgeConfirmState | null>(null)

  const handleOpen = useCallback(() => {
    setState(openPurgeConfirm())
  }, [])

  const handleDismiss = useCallback(() => {
    setState((current) => (current?.running === true ? current : null))
  }, [])

  const handleConfirm = useCallback(() => {
    setState((current) => {
      if (current === null || current.running) return current

      void cloud
        .downloadAndPurge()
        .then((result) => {
          setState(null)
          notify({ text: purgedNotice(result), tone: ENoticeTone.Done })
          onSettled()
        })
        .catch((error: unknown) => {
          setState(null)
          notify({ text: failureNotice(error), tone: ENoticeTone.Warn })
          onSettled()
        })

      return runningPurgeConfirm(current)
    })
  }, [cloud, onSettled])

  const handleKey = useCallback(
    (key: KeyEvent) => {
      if (state === null) return

      if (key.name === 'escape') {
        handleDismiss()
        return
      }

      if (key.name === 'return') handleConfirm()
    },
    [handleConfirm, handleDismiss, state],
  )

  return useMemo(
    () => ({ state, handleOpen, handleDismiss, handleConfirm, handleKey }),
    [handleConfirm, handleDismiss, handleKey, handleOpen, state],
  )
}
