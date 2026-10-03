import type { ThreadId } from '@dltech/atlas-core'

import {
  ATLAS_CONTEXT_DIR_ENV,
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
  RESERVED_SESSION_ENV,
  withoutReservedSessionEnv,
} from '../execution/session-environment'
import { contextDirectory, threadDataDirectory } from '../store/sessions/paths'
import type { SessionRegistry } from '../store/sessions/registry'

export const ATLAS_SHELL_DIR_ENV = 'ATLAS_SHELL_DIR'

export type ThreadEnvironment = Readonly<Record<string, string>>

export type ThreadEnvironmentResolver = (args: {
  threadId: ThreadId
}) => Promise<ThreadEnvironment | undefined>

const ENV_REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g

const referencedNames = (path: string): string[] =>
  [...path.matchAll(ENV_REFERENCE)].map((match) => match[1] ?? match[2] ?? '')

export const referencesShellEnv = (path: string): boolean => referencedNames(path).includes(ATLAS_SHELL_DIR_ENV)

export const referencesSessionEnv = (path: string): boolean =>
  referencedNames(path).some((name) => RESERVED_SESSION_ENV.includes(name))

export function threadEnvironmentFrom({
  sessions,
}: {
  sessions: Pick<SessionRegistry, 'sessionDirOf'>
}): ThreadEnvironmentResolver {
  return async ({ threadId }) => {
    const sessionDir = await sessions.sessionDirOf({ threadId })
    if (sessionDir === undefined) return undefined
    return {
      [ATLAS_SESSION_DIR_ENV]: sessionDir,
      [ATLAS_THREAD_DIR_ENV]: threadDataDirectory({ sessionDir, threadId }),
      [ATLAS_CONTEXT_DIR_ENV]: contextDirectory({ sessionDir }),
    }
  }
}

export function reservedEnvironment({
  base,
  scope,
}: {
  base: NodeJS.ProcessEnv
  scope: ThreadEnvironment
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...withoutReservedSessionEnv(base) }
  delete env[ATLAS_SHELL_DIR_ENV]
  for (const key of RESERVED_SESSION_ENV) {
    const value = scope[key]
    if (value !== undefined) env[key] = value
  }
  return env
}
