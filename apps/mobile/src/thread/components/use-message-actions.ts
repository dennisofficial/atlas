import * as Clipboard from 'expo-clipboard'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { EMessageAction, messageActionsOf, type MessageActionHandlers } from '../message-actions'
import type { MessageRow } from '../rows'

const COPIED_MS = 2_000

export const useMessageActions = (args: {
  row: MessageRow
  queued: boolean
  handlers: MessageActionHandlers | undefined
}): {
  actions: readonly EMessageAction[]
  copied: boolean
  handleAction: (action: EMessageAction) => void
} => {
  const { row, queued, handlers } = args
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const actions = useMemo(
    () =>
      messageActionsOf({
        row,
        queued,
        rewindPoints: handlers?.rewindPoints,
        summarisePoints: handlers?.summarisePoints,
      }),
    [row, queued, handlers],
  )
  const handleAction = useCallback(
    (action: EMessageAction) => {
      if (action === EMessageAction.Copy) {
        void Clipboard.setStringAsync(row.text)
          .then(() => setCopied(true))
          .catch(() => undefined)
        return
      }
      if (action === EMessageAction.Rewind) {
        handlers?.onRewind(row)
        return
      }
      handlers?.onSummarise(row)
    },
    [row, handlers],
  )
  return { actions, copied, handleAction }
}
