import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

export const REFUSAL_SUMMARISE_ARGS = 'Use /summarise, or /summarise <seq>'

export const summariseArgs = z.strictObject({ throughSeq: z.number().int().min(1).optional() })

export type SummariseArgs = z.infer<typeof summariseArgs>

const summariseFromText = (argumentText: string): TextArgs => {
  if (argumentText === '') return { ok: true, args: {} }
  const throughSeq = Number(argumentText)
  if (!Number.isInteger(throughSeq) || throughSeq < 1) {
    return { ok: false, reason: REFUSAL_SUMMARISE_ARGS }
  }
  return { ok: true, args: { throughSeq } }
}

export const summarise = defineCommand({
  spec: {
    name: 'summarise',
    summary: 'Replace everything before one of your messages with a summary',
    group: ECommandGroup.Context,
    argumentHint: '[message]',
    args: summariseArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: summariseFromText,
  },
})
