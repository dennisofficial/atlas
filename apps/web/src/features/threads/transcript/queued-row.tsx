'use client'

import type { QueuedTurn } from '@/features/sessions/data/queued-transcript'

import { TurnView, type QueuedTurnActions, type TranscriptActions } from './transcript-turn'

const DIM = 'opacity-45 transition-opacity hover:opacity-100 focus-within:opacity-100'

export function QueuedRowItem({
  row,
  now,
  models,
  userName,
  actions,
  waitLabel,
  onEdit,
  onRemove,
}: {
  row: QueuedTurn
  now: number
  models: ReadonlyMap<string, string>
  userName: string | undefined
  actions: TranscriptActions
  waitLabel?: string | undefined
  onEdit: (inboxId: string) => void
  onRemove: (inboxId: string) => void
}) {
  const withdraw = row.withdraw
  const queued: QueuedTurnActions | undefined =
    withdraw === undefined
      ? undefined
      : {
          label: waitLabel ?? 'Queued',
          disabled: withdraw.disabled,
          onEdit: () => onEdit(withdraw.inboxId),
          onRemove: () => onRemove(withdraw.inboxId),
        }
  return (
    <section aria-label="Queued" data-queued={row.turn.kind} className={DIM}>
      <TurnView
        turn={row.turn}
        now={now}
        models={models}
        userName={userName}
        actions={actions}
        queued={queued}
      />
    </section>
  )
}
