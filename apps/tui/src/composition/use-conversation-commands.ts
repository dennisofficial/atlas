import { useCallback } from 'react'

import type { PendingQueue } from '../store'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { droppedNotice, type QueuedSettled } from './commands'
import { ECommandEffect } from './commands/local-command'

export function useSettledCommands(args: { pending: PendingQueue<QueuedSettled> }): {
  drainSettledCommands: () => Promise<void>
  handleQueueSettled: (entry: QueuedSettled) => void
} {
  const { pending } = args

  const drainSettledCommands = useCallback(async (): Promise<void> => {
    const queuedCommands = pending.drainCommands()
    if (queuedCommands.length === 0) return

    for (const [index, entry] of queuedCommands.entries()) {
      const { command } = entry
      if (command.dropsQueue) {
        const dropped = droppedNotice({
          command: command.name,
          messages: command.losesWaiting
            ? pending.getSnapshot().filter((one) => one.kind === 'message').length
            : 0,
          commands: queuedCommands.slice(index + 1).map((one) => one.command.name),
        })
        if (dropped !== null) {
          notify({
            key: 'queued-dropped',
            text: dropped,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
        }
      }

      const effect = await command.run()
      if (effect.type === ECommandEffect.Refused) {
        notify({ text: effect.reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
      } else if (effect.type === ECommandEffect.Ran && effect.notice !== undefined) {
        notify({ text: effect.notice })
      }

      if (command.dropsQueue) return
    }
  }, [pending])

  const handleQueueSettled = useCallback(
    (entry: QueuedSettled): void => {
      pending.enqueueCommand({ text: entry.text, command: entry })
    },
    [pending],
  )

  return { drainSettledCommands, handleQueueSettled }
}
