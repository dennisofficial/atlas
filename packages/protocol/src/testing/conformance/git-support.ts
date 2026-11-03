import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $ } from 'bun'
import { afterAll } from 'bun:test'

import { type BranchSet, type CallOp } from '../../ops'
import type { DaemonSession } from '../client'
import { runToEnd } from './support'

export const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Atlas Test',
  GIT_AUTHOR_EMAIL: 'atlas@test.invalid',
  GIT_COMMITTER_NAME: 'Atlas Test',
  GIT_COMMITTER_EMAIL: 'atlas@test.invalid',
}

export const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.length = 0
})

export const makeRepo = async (): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-git-conformance-'))
  tempDirs.push(dir)
  const sh = $.env(gitEnv)
  await sh`git init -b main ${dir}`.quiet()
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  await sh`git -C ${dir} add seed.txt`.quiet()
  await sh`git -C ${dir} commit -m seed`.quiet()
  return dir
}

export const createBranches = async (args: {
  repoPath: string
  names: readonly string[]
}): Promise<void> => {
  const sh = $.env(gitEnv)
  for (const name of args.names) await sh`git -C ${args.repoPath} branch ${name}`.quiet()
}

export const gitOp = (op: 'git.watch' | 'git.unwatch' | 'git.read', repoPath: string): CallOp => ({
  op,
  repoPath,
})

export const runGitOp = async (args: {
  session: DaemonSession
  key: string
  op: 'git.watch' | 'git.unwatch' | 'git.read'
  repoPath: string
}) =>
  await runToEnd({
    session: args.session,
    key: args.key,
    op: gitOp(args.op, args.repoPath),
    timeoutMs: 15000,
  })

export const waitForBranchSet = async (args: {
  session: DaemonSession
  contains: string
  timeoutMs?: number
}): Promise<BranchSet> => {
  const deadline = Date.now() + (args.timeoutMs ?? 8000)
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(
        `no git.branches event containing ${args.contains}; saw ${JSON.stringify(args.session.frames().filter((f) => f.kind === 'event'))}`,
      )
    }
    const frame = await args.session.until(
      (candidate) =>
        candidate.kind === 'event' &&
        candidate.event.type === 'git.branches' &&
        candidate.event.set.branches.some((branch) => branch.name === args.contains),
      { label: `git.branches containing ${args.contains}`, timeoutMs: remaining },
    )
    if (frame.kind !== 'event' || frame.event.type !== 'git.branches')
      throw new Error('unreachable')
    return frame.event.set
  }
}

export const collectEvents = (args: {
  session: DaemonSession
  ms: number
}): Promise<readonly BranchSet[]> =>
  new Promise((resolve) => {
    const sets: BranchSet[] = []
    const timer = setTimeout(() => {
      args.session.close()
      resolve(sets)
    }, args.ms)
    void (async () => {
      for (;;) {
        try {
          const frame = await args.session.until(
            (candidate) => candidate.kind === 'event' && candidate.event.type === 'git.branches',
            { label: 'git.branches', timeoutMs: args.ms },
          )
          if (frame.kind !== 'event' || frame.event.type !== 'git.branches') continue
          sets.push(frame.event.set)
        } catch {
          clearTimeout(timer)
          resolve(sets)
          return
        }
      }
    })()
  })
