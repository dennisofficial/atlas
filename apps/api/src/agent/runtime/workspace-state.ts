import { dirname, join } from 'node:path'

import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export const WORKSPACE_STATE_DIR = '.atlas-agent'
export const MATERIALIZED_SENTINEL = 'workspace-materialized'
export const SETUP_SENTINEL = 'setup-ran'
export const SETUP_STARTED_MARKER = 'setup-started'
export const SESSION_BASES_FILE = 'session-bases'
export const PRIMARY_SENTINEL = 'primary-cloned'
export const TOKEN_FILE = 'github-token'
export const SIGNING_KEY_FILE = 'signing-key'
export const ALLOWED_SIGNERS_FILE = 'allowed-signers'

export type Sentinels = {
  materialized: string
  setupRan: string
  primary: string
  setupStarted: string
  bases: string
}

export type Deps = {
  processes: ProcessPort
  files: FileSystemPort
  log?: LogPort | undefined
  signal?: AbortSignal | undefined
  env?: Record<string, string> | undefined
  warnings?: string[] | undefined
}

const WARNING_TAIL_CHARS = 2000

export const fail = (args: { deps: Deps; message: string; detail?: string | undefined }): void => {
  const tail = (args.detail ?? '').trim().slice(-WARNING_TAIL_CHARS)
  args.deps.warnings?.push(tail === '' ? args.message : `${args.message}: ${tail}`)
}

export const stateDirOf = (launchDirectory: string): string =>
  join(dirname(launchDirectory), WORKSPACE_STATE_DIR)

export const sentinelsOf = (stateDir: string): Sentinels => ({
  materialized: join(stateDir, MATERIALIZED_SENTINEL),
  setupRan: join(stateDir, SETUP_SENTINEL),
  primary: join(stateDir, PRIMARY_SENTINEL),
  setupStarted: join(stateDir, SETUP_STARTED_MARKER),
  bases: join(stateDir, SESSION_BASES_FILE),
})

/**
 * Forgets that a setup script was ever started, so the next prepare may run it. Called when the
 * started script turns out to be unrecoverable, and when the workspace it ran in has been rebuilt.
 */
export const clearSetupStarted = async (args: { deps: Deps; path: string }): Promise<void> => {
  await args.deps.files.removeFile({ path: args.path }).catch(() => undefined)
}

export const additionalSentinelOf = (args: { stateDir: string; repo: string }): string =>
  join(args.stateDir, `additional-cloned-${args.repo.replace('/', '__')}`)

export const exists = async (args: { files: FileSystemPort; path: string }): Promise<boolean> =>
  args.files.stat({ path: args.path }).then(
    () => true,
    () => false,
  )

export const report = (args: { deps: Deps; message: string; detail: string }): void => {
  args.deps.log?.error({
    source: 'runtime.workspace-setup',
    message: args.message,
    error: args.detail,
  })
}

export const checkSentinels = async (args: {
  deps: Deps
  sentinels: Sentinels
  launchDirectory: string
}) => ({
  materialized:
    (await exists({ files: args.deps.files, path: args.sentinels.materialized })) &&
    (await exists({ files: args.deps.files, path: args.launchDirectory })),
  setupRan: await exists({ files: args.deps.files, path: args.sentinels.setupRan }),
  setupStarted: await readSetupStarted({ deps: args.deps, path: args.sentinels.setupStarted }),
})

export type SetupStartedMarker = { bootId?: string | undefined }

/**
 * The marker a host writes before it dispatches the setup script. Its boot id is what tells a later
 * host whether the pod ever had the chance to run that script.
 */
export const readSetupStarted = async (args: {
  deps: Deps
  path: string
}): Promise<SetupStartedMarker | undefined> => {
  const found = await args.deps.files.readFile({ path: args.path }).then(
    (text) => text,
    () => null,
  )
  if (found === null) return undefined
  try {
    const parsed = JSON.parse(found) as { bootId?: unknown }
    return { ...(typeof parsed.bootId === 'string' ? { bootId: parsed.bootId } : {}) }
  } catch {
    return {}
  }
}

export const writeSentinel = async (args: {
  deps: Deps
  path: string
  message: string
  bootId?: string | undefined
}): Promise<boolean> => {
  try {
    await args.deps.files.writeFile({
      path: args.path,
      content: JSON.stringify({
        at: new Date().toISOString(),
        ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
      }),
    })
    return true
  } catch (error) {
    fail({ deps: args.deps, message: args.message, detail: String(error) })
    args.deps.log?.error({
      source: 'runtime.workspace-setup',
      message: args.message,
      ...logFieldsOf({ error }),
    })
    return false
  }
}
