import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

export const RENAME_NAME_MAX_LENGTH = 200

export const renameArgs = z.strictObject({
  name: z.string().trim().min(1).max(RENAME_NAME_MAX_LENGTH),
})

export type RenameArgs = z.infer<typeof renameArgs>

export const rename = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session',
    group: ECommandGroup.Session,
    args: renameArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'control',
  },
})
