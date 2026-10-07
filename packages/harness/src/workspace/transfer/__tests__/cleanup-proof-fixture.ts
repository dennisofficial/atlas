import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureSourceCleanupProof, type SourceCleanupProof } from '../cleanup-proof'
import { capture, createScratch, git } from './capture-fixture'

export const SESSION = 'session-source'
export const GENERATION = 'generation-1'

export type Repository = { scratch: string; main: string; active: string; peer: string }

export async function createRepository(): Promise<Repository> {
  const scratch = await createScratch()
  const main = join(scratch, 'repo')
  await mkdir(main, { recursive: true })
  await git({ args: ['init', '-b', 'main'], cwd: main })
  await writeFile(join(main, '.gitignore'), '.atlas/\n*.log\n')
  await writeFile(join(main, 'app.ts'), 'export const one = 1\n')
  await git({ args: ['add', '-A'], cwd: main })
  await git({ args: ['commit', '-m', 'seed'], cwd: main })
  return {
    scratch,
    main,
    active: join(main, '.atlas', 'worktrees', 'active'),
    peer: join(main, '.atlas', 'worktrees', 'peer'),
  }
}

export const addActive = ({ main, active }: Repository): Promise<string> =>
  git({ args: ['worktree', 'add', active, '-b', 'active'], cwd: main })

export const addPeer = ({ main, peer }: Repository): Promise<string> =>
  git({ args: ['worktree', 'add', peer, '-b', 'peer-work'], cwd: main })

export async function proofOf({ cwd }: { cwd: string }): Promise<SourceCleanupProof> {
  const { manifest } = await capture({ cwd })
  return captureSourceCleanupProof({ cwd, manifest, generation: GENERATION, sourceSessionId: SESSION })
}
