import { ERepoTreeEntryKind, HOME_MOUNT_PREFIX } from '@dltech/atlas-wire/web'

export const DEFAULT_MODE_TEXT = '0600'
export const MODE_PATTERN = /^0?[0-7]{3}$/
export const MAX_PICKER_CHOICES = 50

export type TreeEntry = { path: string; kind: ERepoTreeEntryKind }

export function parseFileMode(text: string): number | null {
  const trimmed = text.trim()
  return MODE_PATTERN.test(trimmed) ? Number.parseInt(trimmed, 8) : null
}

export function formatFileMode(mode: number): string {
  return mode.toString(8).padStart(4, '0')
}

const choiceOf = (entry: TreeEntry): string =>
  entry.kind === ERepoTreeEntryKind.Folder ? `${entry.path}/` : entry.path

export function pickerChoices({
  entries,
  query,
}: {
  entries: readonly TreeEntry[]
  query: string
}): string[] {
  const needle = query.trim().toLowerCase()
  if (needle.startsWith(HOME_MOUNT_PREFIX)) return []
  const choices = entries.map(choiceOf).filter((choice) => choice.toLowerCase().includes(needle))
  const rank = (choice: string) => (choice.toLowerCase().startsWith(needle) ? 0 : 1)
  return choices
    .toSorted((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b))
    .slice(0, MAX_PICKER_CHOICES)
}
