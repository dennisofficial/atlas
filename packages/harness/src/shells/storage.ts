import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'

import { ensurePrivateDirectory, PRIVATE_DIRECTORY_MODE } from '../execution/session-environment'
import { sessionLockFile, threadDataDirectory } from '../store/sessions/paths'
import type { SessionRegistry } from '../store/sessions/registry'
import { CONFIG_FILE, SPOOL_FILE } from './durable/protocol'
import { toShellId, type ShellId } from './shell-id'

export const SHELLS_DIRECTORY_NAME = 'shells'
export const SHELL_ID_PREFIX = 'shell_'
export const SHELL_OUTPUT_FILE_NAME = SPOOL_FILE
export const SHELL_CONFIG_FILE_NAME = CONFIG_FILE
export const SHELL_LOCK_FILE_NAME = 'lock'
export const SHELL_CURSOR_FILE_NAME = 'cursor'

const SHELL_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_ID_ATTEMPTS = 8
const SHELL_ID_BYTES = 16

export type ShellFiles = {
  sessionDirectory: string
  threadDirectory: string
  sessionLock: string
  directory: string
  output: string
  config: string
  lock: string
  cursor: string
}

export type CreatedShell = ShellFiles & { shellId: ShellId }

export class UnknownShellThread extends Error {
  constructor(threadId: ThreadId) {
    super(`thread ${threadId} is not registered in any session, so it has no place to keep shells`)
    this.name = 'UnknownShellThread'
  }
}

export function shellsDirectory({
  sessionDir,
  threadId,
}: {
  sessionDir: string
  threadId: ThreadId
}): string {
  return join(threadDataDirectory({ sessionDir, threadId }), SHELLS_DIRECTORY_NAME)
}

export function shellFiles({
  sessionDir,
  threadId,
  shellId,
}: {
  sessionDir: string
  threadId: ThreadId
  shellId: ShellId
}): ShellFiles {
  if (!SHELL_ID_PATTERN.test(shellId)) throw new Error(`${shellId} is not a usable shell directory name`)
  const directory = join(shellsDirectory({ sessionDir, threadId }), shellId)
  return {
    sessionDirectory: sessionDir,
    threadDirectory: threadDataDirectory({ sessionDir, threadId }),
    sessionLock: sessionLockFile({ sessionDir }),
    directory,
    output: join(directory, SHELL_OUTPUT_FILE_NAME),
    config: join(directory, SHELL_CONFIG_FILE_NAME),
    lock: join(directory, SHELL_LOCK_FILE_NAME),
    cursor: join(directory, SHELL_CURSOR_FILE_NAME),
  }
}

export const randomShellId = (): ShellId =>
  toShellId(`${SHELL_ID_PREFIX}${randomBytes(SHELL_ID_BYTES).toString('hex')}`)

const isAlreadyExists = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST'

export class ShellStorage {
  private readonly sessions: Pick<SessionRegistry, 'sessionDirOf'>
  private readonly newId: () => ShellId

  constructor(args: {
    sessions: Pick<SessionRegistry, 'sessionDirOf'>
    newId?: (() => ShellId) | undefined
  }) {
    this.sessions = args.sessions
    this.newId = args.newId ?? randomShellId
  }

  async create({ threadId }: { threadId: ThreadId }): Promise<CreatedShell> {
    const sessionDir = await this.sessions.sessionDirOf({ threadId })
    if (sessionDir === undefined) throw new UnknownShellThread(threadId)

    await ensurePrivateDirectory({
      anchor: dirname(sessionDir),
      directory: shellsDirectory({ sessionDir, threadId }),
    })
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const shellId = this.newId()
      const files = shellFiles({ sessionDir, threadId, shellId })
      try {
        await mkdir(files.directory, { mode: PRIVATE_DIRECTORY_MODE })
        return { shellId, ...files }
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
    }
    throw new Error(`could not find an unused shell id for thread ${threadId}`)
  }

  async locate({
    threadId,
    shellId,
  }: {
    threadId: ThreadId
    shellId: ShellId
  }): Promise<ShellFiles | undefined> {
    const sessionDir = await this.sessions.sessionDirOf({ threadId })
    if (sessionDir === undefined) return undefined
    return shellFiles({ sessionDir, threadId, shellId })
  }
}
