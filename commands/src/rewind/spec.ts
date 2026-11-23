import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import type { Event } from '@dltech/atlas-core'
import { z } from 'zod'

export const REFUSAL_NOT_A_MESSAGE = 'Only one of your messages can be rewound to'
export const REFUSAL_NOTHING_TO_REWIND = 'Nothing to rewind yet'
export const REFUSAL_REWIND_NEEDS_LINE =
  'Pick the message to rewind to: /rewind <seq>, or use Rewind on the message'

export const rewindArgs = z.strictObject({ toSeq: z.number().int().min(1) })

export type RewindArgs = z.infer<typeof rewindArgs>

const seqOf = (argumentText: string): number | undefined => {
  const seq = Number(argumentText)
  return Number.isInteger(seq) && seq >= 1 ? seq : undefined
}

const rewindFromText = (argumentText: string): TextArgs => {
  const toSeq = seqOf(argumentText)
  if (toSeq === undefined) return { ok: false, reason: REFUSAL_REWIND_NEEDS_LINE }
  return { ok: true, args: { toSeq } }
}

export const rewind = defineCommand({
  spec: {
    name: 'rewind',
    summary: 'Rewind the conversation to one of your messages and edit it again',
    group: ECommandGroup.Context,
    argumentHint: '<message>',
    args: rewindArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: rewindFromText,
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
