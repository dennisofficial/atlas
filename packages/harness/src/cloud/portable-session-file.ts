import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SESSION_LOCK_NAME, THREADS_DIRECTORY_NAME } from '../store/sessions/paths'
import { EShellPhase, SOCKET_FILE, STATUS_FILE, TOKEN_FILE } from '../shells/durable/protocol'
import { SHELL_LOCK_FILE_NAME, SHELLS_DIRECTORY_NAME } from '../shells/storage'

export const IMPORTED_SHELL_ORIGIN_FILE = 'origin'
export const IMPORTED_SHELL_ORIGIN = 'imported'

const LEASE_DIRECTORY = 'leases'
const LEASE_SUFFIX = '.lease'
const KEY_SEPARATOR = '/'
const SHELL_DIRECTORY_SEGMENTS = 4
const MACHINE_BOUND_SHELL_FILES: ReadonlySet<string> = new Set([
  TOKEN_FILE,
  SOCKET_FILE,
  SHELL_LOCK_FILE_NAME,
])
const TERMINAL_PHASES: ReadonlySet<unknown> = new Set([EShellPhase.Exited, EShellPhase.StartFailed])

export function shellDirectoryOf({ key }: { key: string }): string | undefined {
  const parts = key.split(KEY_SEPARATOR)
  if (parts.length <= SHELL_DIRECTORY_SEGMENTS) return undefined
  if (parts[0] !== THREADS_DIRECTORY_NAME || parts[2] !== SHELLS_DIRECTORY_NAME) return undefined
  if (parts[1] === '' || parts[3] === '') return undefined
  return parts.slice(0, SHELL_DIRECTORY_SEGMENTS).join(KEY_SEPARATOR)
}

export function isPortableSessionFile({ key }: { key: string }): boolean {
  if (key === SESSION_LOCK_NAME) return false
  const directory = shellDirectoryOf({ key })
  if (directory === undefined) return true
  const rest = key.slice(directory.length + 1).split(KEY_SEPARATOR)
  if (rest.length === 1) return !MACHINE_BOUND_SHELL_FILES.has(rest[0] ?? '')
  return !(rest.length === 2 && rest[0] === LEASE_DIRECTORY && (rest[1] ?? '').endsWith(LEASE_SUFFIX))
}

export function shellDirectoriesOf({ keys }: { keys: readonly string[] }): readonly string[] {
  const directories = new Set<string>()
  for (const key of keys) {
    const directory = shellDirectoryOf({ key })
    if (directory !== undefined) directories.add(directory)
  }
  return [...directories]
}

const hasTerminalStatus = async (directory: string): Promise<boolean> => {
  const status = await readFile(join(directory, STATUS_FILE), 'utf8').catch(() => undefined)
  if (status === undefined) return false
  try {
    const parsed: unknown = JSON.parse(status)
    if (typeof parsed !== 'object' || parsed === null || !('phase' in parsed)) return false
    return TERMINAL_PHASES.has(parsed.phase)
  } catch {
    return false
  }
}

export async function assertShellsTerminal({
  sessionDir,
  keys,
}: {
  sessionDir: string
  keys: readonly string[]
}): Promise<void> {
  const directories = shellDirectoriesOf({ keys })
  const checks = await Promise.all(
    directories.map(async (directory) => ({
      directory,
      terminal: await hasTerminalStatus(join(sessionDir, directory)),
    })),
  )
  const unproven = checks.filter((check) => !check.terminal).map((check) => check.directory)
  if (unproven.length === 0) return
  throw new Error(
    `the session cannot move while background shells have no terminal status: ${unproven.join(', ')}`,
  )
}

export async function markShellsImported({
  root,
  keys,
}: {
  root: string
  keys: readonly string[]
}): Promise<void> {
  for (const directory of shellDirectoriesOf({ keys })) {
    await writeFile(join(root, directory, IMPORTED_SHELL_ORIGIN_FILE), IMPORTED_SHELL_ORIGIN)
  }
}
