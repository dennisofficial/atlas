import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming, type Event } from '@dltech/atlas-core'
import { z } from 'zod'

export const REFUSAL_NOT_A_MESSAGE = 'Only one of your messages can be rewound to'
export const REFUSAL_NOTHING_TO_REWIND = 'Nothing to rewind yet'

export const rewindArgs = z.strictObject({ toSeq: z.number().int().min(1) })

export type RewindArgs = z.infer<typeof rewindArgs>

export const rewind = defineCommand({
  spec: {
    name: 'rewind',
    summary: 'Rewind the conversation to one of your messages and edit it again',
    group: ECommandGroup.Context,
    args: rewindArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

export type RewindTarget = { allowed: true; draft: string } | { allowed: false; reason: string }

export const rewindTargetOf = ({
  events,
  toSeq,
}: {
  events: readonly Event[]
  toSeq: number
}): RewindTarget => {
  const picked = events.find((event) => event.seq === toSeq)
  if (picked === undefined || picked.type !== 'user-said') {
    return { allowed: false, reason: REFUSAL_NOT_A_MESSAGE }
  }
  if (events.at(-1)?.seq === toSeq) return { allowed: false, reason: REFUSAL_NOTHING_TO_REWIND }
  return { allowed: true, draft: picked.text }
}
