import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

export const REFUSAL_ROTATE_CHILDREN = 'A sub-agent is still running; stop it first.'

export const rotateArgs = z.strictObject({ instructions: z.string().max(2000).optional() })

export type RotateArgs = z.infer<typeof rotateArgs>

const rotateFromText = (argumentText: string): TextArgs => {
  const instructions = argumentText.trim()
  return { ok: true, args: instructions === '' ? {} : { instructions } }
}

export const rotate = defineCommand({
  spec: {
    name: 'rotate',
    summary: 'Start a fresh context in this thread from a handoff brief',
    group: ECommandGroup.Context,
    argumentHint: '[instructions]',
    args: rotateArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: rotateFromText,
  },
})
