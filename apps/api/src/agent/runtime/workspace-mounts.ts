import { EProcessOutcome, outcomeOf, type ProcessPort } from '@dltech/atlas-core'
import type { BootNotice } from '@dltech/atlas-host'
import { SANDBOX_HOME_PATH } from '../sandbox/constants'

import { EProjectFileState, type ScopedFileMount } from './project-files'
import { projectFileNoticeOf } from './project-file-notice'
import { writeProjectFiles } from './project-file-writer'
import type { Deps } from './workspace-state'

const sandboxHomeOf = async (args: { processes: ProcessPort }): Promise<string | null> => {
  const handle = args.processes.spawn({ cmd: ['sh', '-c', 'printf %s "$HOME"'], cwd: '/' })
  const [outcome, home] = await Promise.all([
    outcomeOf(handle),
    new Response(handle.stdout).text(),
    new Response(handle.stderr).text(),
  ])
  const path = home.trim()
  return outcome.kind === EProcessOutcome.Exited && outcome.code === 0 && path !== '' ? path : null
}

export const mountProjectFiles = async (args: {
  deps: Deps
  mounts: readonly ScopedFileMount[]
  launchDirectory: string
  notices: BootNotice[]
}): Promise<void> => {
  if (args.mounts.length === 0) return
  const outcomes = await writeProjectFiles({
    mounts: args.mounts,
    files: args.deps.files,
    processes: args.deps.processes,
    roots: {
      repositoryDir: args.launchDirectory,
      home: await sandboxHomeOf({ processes: args.deps.processes }),
      atlasHome: SANDBOX_HOME_PATH,
    },
    ...(args.deps.signal === undefined ? {} : { signal: args.deps.signal }),
  })
  for (const outcome of outcomes) {
    if (outcome.state === EProjectFileState.Written) continue
    args.deps.log?.warn({
      source: 'runtime.workspace-setup',
      message: `project file mount ${outcome.path} ended as ${outcome.state}`,
    })
  }
  const notice = projectFileNoticeOf(outcomes)
  if (notice !== null) args.notices.push({ slot: 'project-file-mounts', content: notice })
}
