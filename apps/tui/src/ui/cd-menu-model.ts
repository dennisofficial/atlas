import {
  browseCandidates,
  completedMentionPath,
  splitMentionQuery,
  type DirectoryEntry,
  type MentionQuery,
} from '@dltech/atlas-core'

import { selectedEntry, type FileMenuState } from './file-menu-model'

const CD_PREFIX = '/cd '

export function cdQueryOf(text: string): MentionQuery | null {
  if (!text.startsWith(CD_PREFIX)) return null

  const argument = text.slice(CD_PREFIX.length)
  if (/\s/.test(argument)) return null

  return splitMentionQuery(argument)
}

export function openCdMenu(args: {
  query: MentionQuery
  entries: readonly DirectoryEntry[]
}): FileMenuState | null {
  const matches = browseCandidates({
    entries: args.entries.filter((entry) => entry.isDirectory),
    fragment: args.query.fragment,
  })

  if (matches.length === 0) return null

  return { index: 0, directory: args.query.directory, fragment: args.query.fragment, matches }
}

export function completedCdArgument(args: { text: string; state: FileMenuState }): string | null {
  const entry = selectedEntry(args.state)
  if (entry === null) return null

  return `${CD_PREFIX}${completedMentionPath({ directory: args.state.directory, entry }).path}`
}
