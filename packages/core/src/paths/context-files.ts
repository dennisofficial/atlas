export const SPAWN_FILES_MAX_COUNT = 32
export const SPAWN_FILES_MAX_BYTES = 1_000_000
export const SPAWN_FILE_MAX_BYTES = 256_000

export const ATLAS_CONTEXT_DIR_ENV = 'ATLAS_CONTEXT_DIR'

export type SpawnFile = { path: string; text: string }

export type ContextFilePath = { ok: true; path: string } | { ok: false; reason: string }

const MAX_RELATIVE_PATH_LENGTH = 200

const byteLengthOf = (text: string): number => new TextEncoder().encode(text).length

export function contextFilePathOf(args: {
  directory: string
  relativePath: string
}): ContextFilePath {
  const relativePath = args.relativePath
  if (relativePath.length === 0) {
    return { ok: false, reason: 'name a file, not an empty path' }
  }
  if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) {
    return {
      ok: false,
      reason: `${relativePath.slice(0, 40)}… is longer than ${MAX_RELATIVE_PATH_LENGTH} characters`,
    }
  }
  if (relativePath.startsWith('/')) {
    return {
      ok: false,
      reason: `${relativePath} is absolute; name it relative to $ATLAS_CONTEXT_DIR`,
    }
  }
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return {
      ok: false,
      reason: `${relativePath} has an empty, . or .. folder; name a file inside $ATLAS_CONTEXT_DIR`,
    }
  }
  return { ok: true, path: `${args.directory.replace(/\/+$/, '')}/${relativePath}` }
}

export function spawnFilesRefusalOf(files: readonly SpawnFile[] | undefined): string | null {
  if (files === undefined) return null
  if (files.length > SPAWN_FILES_MAX_COUNT) {
    return `attach at most ${SPAWN_FILES_MAX_COUNT} files, not ${files.length}`
  }
  let total = 0
  for (const file of files) {
    const resolved = contextFilePathOf({ directory: '', relativePath: file.path })
    if (!resolved.ok) return resolved.reason
    const bytes = byteLengthOf(file.text)
    if (file.text.includes('\u0000')) {
      return `${file.path} holds a NUL byte, so it is not text; attach a text file`
    }
    if (bytes > SPAWN_FILE_MAX_BYTES) {
      return `${file.path} is ${bytes} bytes; attach files of at most ${SPAWN_FILE_MAX_BYTES} bytes each`
    }
    total += bytes
  }
  if (total > SPAWN_FILES_MAX_BYTES) {
    return `the attached files are ${total} bytes; attach at most ${SPAWN_FILES_MAX_BYTES} bytes in all`
  }
  return null
}

export const attachedFilesLineOf = (files: readonly SpawnFile[]): string =>
  `Attached to $ATLAS_CONTEXT_DIR: ${files.map((file) => file.path).join(', ')}`

export function spawnBriefOf(args: {
  brief: string | undefined
  files: readonly SpawnFile[]
}): string {
  const brief = args.brief?.trim() ?? ''
  if (args.files.length === 0) return brief
  const line = attachedFilesLineOf(args.files)
  return brief === '' ? line : `${brief}\n\n${line}`
}
