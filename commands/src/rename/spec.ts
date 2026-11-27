import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

export const RENAME_NAME_MAX_LENGTH = 200

export const REFUSAL_RENAME_NO_SUGGESTION =
  '/rename could not name this session from its transcript. Try /rename <name>'

export const renameArgs = z.strictObject({
  name: z.string().trim().min(1).max(RENAME_NAME_MAX_LENGTH).optional(),
})

export type RenameArgs = z.infer<typeof renameArgs>

const fromText = (argumentText: string): TextArgs => {
  if (argumentText === '') return { ok: true, args: {} }
  return { ok: true, args: { name: argumentText } }
}

export const rename = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session, or name it from its transcript',
    group: ECommandGroup.Session,
    argumentHint: '[name]',
    args: renameArgs,
    runsIn: ECommandRunsIn.Control,
    fromText,
  },
})
