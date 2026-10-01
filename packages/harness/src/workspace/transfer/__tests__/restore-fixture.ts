import { rm } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { createFixture, createScratch, git, type Fixture } from './capture-fixture'

export { git, type Fixture }

const scratches: string[] = []
const fixtures: Fixture[] = []

export async function scratch(): Promise<string> {
  const path = await createScratch()
  scratches.push(path)
  return path
}

export async function fixture(): Promise<Fixture> {
  const made = await createFixture()
  fixtures.push(made)
  return made
}

export async function cleanup(): Promise<void> {
  await Promise.all([
    ...scratches.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    ...fixtures.splice(0).map((made) => made.cleanup()),
  ])
}

export async function archiveOf({ cwd }: { cwd: string }) {
  const archivePath = join(await scratch(), 'workspace.tar.gz')
  const manifest = await captureWorkspaceArchive({ cwd, destination: archivePath })
  return { archivePath, manifest }
}

export const status = (cwd: string): Promise<string> =>
  git({ args: ['status', '--porcelain=v1', '-uall'], cwd })

export const headOf = (cwd: string): Promise<string> => git({ args: ['rev-parse', 'HEAD'], cwd })

export const refOf = (cwd: string, ref: string): Promise<string> =>
  git({ args: ['rev-parse', '--verify', '--quiet', ref], cwd }).catch(() => '')

export async function commitAll(cwd: string, message: string): Promise<string> {
  await git({ args: ['add', '-A'], cwd })
  await git({ args: ['commit', '-m', message], cwd })
  return headOf(cwd)
}

export const worktreePaths = async (cwd: string): Promise<string[]> =>
  (await git({ args: ['worktree', 'list', '--porcelain'], cwd }))
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
