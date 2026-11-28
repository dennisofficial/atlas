import { EUserFileTree } from '@dltech/atlas-wire/web'

export const INSTRUCTIONS_PATH = '.atlas/ATLAS.md'
export const INSTRUCTIONS_TREE = EUserFileTree.Instructions
export const INSTRUCTIONS_CHAR_LIMIT = 8000

export const INSTRUCTIONS_DESCRIPTION =
  "Loaded into every thread, before the repository's AGENTS.md files."
export const GROUP_INSTRUCTIONS_DESCRIPTION =
  "Loaded into every thread on every project of this group, after the personal instructions and before the repository's AGENTS.md files."
export const INHERITED_INSTRUCTIONS_DESCRIPTION = "Loaded first, before this group's text."

export type TInstructionsDoc = { text: string; revision: number }

export type TInstructionFile = {
  path: string
  revision: number
  content: string | null
  tombstonedAt: string | null
}

export type TCharCount = { text: string; over: boolean }

const formatted = (value: number): string => value.toLocaleString('en-US')

export const charCountOf = ({ length, limit }: { length: number; limit: number }): TCharCount => {
  const over = length - limit
  const count = `${formatted(length)} / ${formatted(limit)}`
  return over > 0
    ? { text: `${count}, ${formatted(over)} over`, over: true }
    : { text: count, over: false }
}

export const canSaveInstructions = ({
  dirty,
  length,
  limit,
  saving,
}: {
  dirty: boolean
  length: number
  limit: number
  saving: boolean
}): boolean => dirty && length <= limit && !saving

export const instructionsOf = ({
  files,
  path = INSTRUCTIONS_PATH,
  decode,
}: {
  files: readonly TInstructionFile[]
  path?: string
  decode: (encoded: string) => string
}): TInstructionsDoc => {
  const file = files.find((candidate) => candidate.path === path)
  if (file === undefined) return { text: '', revision: 0 }
  const live = file.tombstonedAt === null && file.content !== null
  return { text: live ? decode(file.content ?? '') : '', revision: file.revision }
}
