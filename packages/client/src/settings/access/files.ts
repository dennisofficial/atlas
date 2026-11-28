import {
  ERepoTreeEntryKind,
  HOME_MOUNT_PREFIX,
  MAX_FILE_MOUNT_BYTES,
  fileMountPathProblem,
  personalFileMountPathProblem,
} from '@dltech/atlas-wire/web'

export const DEFAULT_MODE_TEXT = '0600'
export const MODE_PATTERN = /^0?[0-7]{3}$/
export const MAX_PICKER_CHOICES = 50

export type TreeEntry = { path: string; kind: ERepoTreeEntryKind }
export type AccessFileDraft = { path: string; contents: string; mode: number }
export type EditingFile = { path: string; contents: string; modeText: string }

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

export function accessFileValidation({
  personal,
  path,
  contents,
  modeText,
}: EditingFile & { personal: boolean }) {
  const pathProblem =
    path === ''
      ? null
      : personal
        ? personalFileMountPathProblem(path.trim())
        : fileMountPathProblem(path.trim())
  const mode = parseFileMode(modeText)
  const contentsTooLarge = new TextEncoder().encode(contents).byteLength > MAX_FILE_MOUNT_BYTES
  return {
    pathProblem,
    mode,
    contentsTooLarge,
    draft:
      path.trim() !== '' && pathProblem === null && mode !== null && !contentsTooLarge
        ? { path: path.trim(), contents, mode }
        : null,
  }
}
