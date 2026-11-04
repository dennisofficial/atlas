import { dirname, join } from 'node:path'

import type { FileSystemPort, ProcessPort } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export const WORKSPACE_STATE_DIR = '.atlas-agent'
export const MATERIALIZED_SENTINEL = 'workspace-materialized'
export const SETUP_SENTINEL = 'setup-ran'
export const TOKEN_FILE = 'github-token'

export type Sentinels = { materialized: string; setupRan: string }

export type Deps = {
  processes: ProcessPort
  files: FileSystemPort
  log?: LogPort | undefined
  failures?: string[] | undefined
}

const FAILURE_TAIL_CHARS = 1000

export const fail = (args: { deps: Deps; message: string; detail?: string | undefined }): void => {
  const tail = (args.detail ?? '').trim().slice(-FAILURE_TAIL_CHARS)
  args.deps.failures?.push(tail === '' ? args.message : `${args.message}: ${tail}`)
}

export const stateDirOf = (launchDirectory: string): string =>
  join(dirname(launchDirectory), WORKSPACE_STATE_DIR)

export const sentinelsOf = (stateDir: string): Sentinels => ({
  materialized: join(stateDir, MATERIALIZED_SENTINEL),
  setupRan: join(stateDir, SETUP_SENTINEL),
})

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

export const checkSentinels = async (args: { deps: Deps; sentinels: Sentinels }) => ({
  materialized: await exists({ files: args.deps.files, path: args.sentinels.materialized }),
  setupRan: await exists({ files: args.deps.files, path: args.sentinels.setupRan }),
})

export const writeSentinel = async (args: {
  deps: Deps
  path: string
  message: string
}): Promise<boolean> => {
  try {
    await args.deps.files.writeFile({
      path: args.path,
      content: JSON.stringify({ at: new Date().toISOString() }),
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
