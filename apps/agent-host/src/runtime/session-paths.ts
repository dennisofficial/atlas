import { join } from 'node:path'

import { ATLAS_HOME_ENV, type ThreadId } from '@dltech/atlas-core'

import { SANDBOX_HOME_PATH } from '../sandbox/constants'

export const SESSIONS_DIRECTORY_NAME = 'sessions'
export const THREADS_DIRECTORY_NAME = 'threads'
export const CONTEXT_DIRECTORY_NAME = 'context'
export const IMAGES_DIRECTORY_NAME = 'images'

export const ATLAS_SESSION_DIR_ENV = 'ATLAS_SESSION_DIR'
export const ATLAS_THREAD_DIR_ENV = 'ATLAS_THREAD_DIR'
export const ATLAS_CONTEXT_DIR_ENV = 'ATLAS_CONTEXT_DIR'

export const SESSION_PATH_ENV_NAMES: readonly string[] = [
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
  ATLAS_CONTEXT_DIR_ENV,
]

export type SessionPaths = {
  home: string
  sessionDir: string
  threadDir: string
  contextDir: string
  imagesDir: string
}

export type PathEnvironment = Readonly<Record<string, string | undefined>>

export function sessionPathsOf(args: {
  sessionId: string
  threadId: ThreadId
  home?: string | undefined
}): SessionPaths {
  const home = args.home ?? SANDBOX_HOME_PATH
  const sessionDir = join(home, SESSIONS_DIRECTORY_NAME, args.sessionId)
  return {
    home,
    sessionDir,
    threadDir: join(sessionDir, THREADS_DIRECTORY_NAME, args.threadId),
    contextDir: join(sessionDir, CONTEXT_DIRECTORY_NAME),
    imagesDir: join(sessionDir, IMAGES_DIRECTORY_NAME),
  }
}

export const sessionEnvironmentOf = (paths: SessionPaths): Record<string, string> => ({
  [ATLAS_SESSION_DIR_ENV]: paths.sessionDir,
  [ATLAS_THREAD_DIR_ENV]: paths.threadDir,
  [ATLAS_CONTEXT_DIR_ENV]: paths.contextDir,
})

export const pathEnvironmentOf = (paths: SessionPaths): Record<string, string> => ({
  [ATLAS_HOME_ENV]: paths.home,
  ...sessionEnvironmentOf(paths),
})

export const shellEnvironmentOf = (args: {
  paths: SessionPaths
  base: Record<string, string>
}): Record<string, string> => ({
  ...args.base,
  ...pathEnvironmentOf(args.paths),
})
