import { isAbsolute, resolve } from 'node:path'

import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const runGit = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
  argv: readonly string[]
}): Promise<string> => {
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let child: ManagedProcess
  try {
    child = ManagedProcess.spawn({
      cmd: ['git', '-C', args.repoPath, ...args.argv],
      env: { ...args.deps.env, GIT_OPTIONAL_LOCKS: '0' },
      onStdout: (bytes) => stdout.push(Buffer.from(bytes)),
      onStderr: (bytes) => stderr.push(Buffer.from(bytes)),
    })
  } catch (error) {
    throw new CallFailureError({
      code: ECallFailure.SpawnFailed,
      message: `git could not start: ${messageOf(error)}`,
    })
  }
  const exit = await child.exit()
  if (exit.exitCode === 0) return Buffer.concat(stdout).toString('utf8')
  const detail = Buffer.concat(stderr).toString('utf8').trim()
  throw new CallFailureError({
    code: ECallFailure.Internal,
    message: `git ${args.argv[0] ?? ''} failed (exit ${String(exit.exitCode)}): ${detail}`,
  })
}

export const commonGitDirOf = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
}): Promise<string> => {
  let output: string
  try {
    output = await runGit({
      deps: args.deps,
      repoPath: args.repoPath,
      argv: ['rev-parse', '--git-common-dir'],
    })
  } catch (error) {
    if (error instanceof CallFailureError && error.failure.code === ECallFailure.SpawnFailed)
      throw error
    throw new CallFailureError({
      code: ECallFailure.NotFound,
      message: `not a git repository: ${args.repoPath}`,
    })
  }
  const dir = output.trim()
  if (dir === '') {
    throw new CallFailureError({
      code: ECallFailure.NotFound,
      message: `not a git repository: ${args.repoPath}`,
    })
  }
  return isAbsolute(dir) ? dir : resolve(args.repoPath, dir)
}
