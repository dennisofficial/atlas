import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  CLONE_PREFETCH_DIR,
  CLONE_PREFETCH_LOCK,
  CLONE_PREFETCH_REPO_DIR,
  clonePrefetchWaitScript,
  parseClonePrefetchResult,
} from '@dltech/atlas-wire'

import type { WorkspaceFiles } from './workspace-files'

const LOCK_WAIT_SECONDS = 300

export type PrefetchAdoptionDeps = {
  waitForResult: () => Promise<string | undefined>
  move: (args: { from: string; to: string }) => Promise<void>
  discard: (path: string) => Promise<void>
  log: (line: string) => void
}

const waitViaFlock = async (): Promise<string | undefined> => {
  const spawned = Bun.spawn(
    [
      'flock',
      '-w',
      String(LOCK_WAIT_SECONDS),
      CLONE_PREFETCH_LOCK,
      'sh',
      '-c',
      clonePrefetchWaitScript(),
    ],
    { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' },
  )
  const [text, code] = await Promise.all([new Response(spawned.stdout).text(), spawned.exited])
  return code === 0 ? text : undefined
}

export const defaultAdoptionDeps: PrefetchAdoptionDeps = {
  waitForResult: waitViaFlock,
  move: async ({ from, to }) => {
    await mkdir(dirname(to), { recursive: true })
    await rename(from, to)
  },
  discard: (path) => rm(path, { recursive: true, force: true }),
  log: (line) =>
    process.stderr.write(`${JSON.stringify({ event: 'serve.clone-prefetch', line })}\n`),
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

async function adopt(args: {
  cwd: string
  files: WorkspaceFiles
  deps: PrefetchAdoptionDeps
}): Promise<boolean> {
  const { deps } = args
  try {
    const raw = await deps.waitForResult()
    const result = raw === undefined ? undefined : parseClonePrefetchResult(raw)
    if (result === undefined) {
      deps.log('no prefetched clone result; cloning directly')
      return false
    }
    if (!result.ok) {
      deps.log(`prefetched clone failed (${result.reason}); cloning directly`)
      return false
    }
    await args.files.empty(args.cwd)
    await deps.move({ from: CLONE_PREFETCH_REPO_DIR, to: args.cwd })
    return true
  } catch (error) {
    deps.log(`adopting the prefetched clone failed (${messageOf(error)}); cloning directly`)
    return false
  } finally {
    await deps.discard(CLONE_PREFETCH_DIR).catch(() => undefined)
  }
}

export async function beginPrefetchAdoption(args: {
  cwd: string
  files: WorkspaceFiles
  deps?: PrefetchAdoptionDeps | undefined
}): Promise<{ adopted: Promise<boolean> } | undefined> {
  if (!(await args.files.exists(CLONE_PREFETCH_DIR))) return undefined
  return { adopted: adopt({ ...args, deps: args.deps ?? defaultAdoptionDeps }) }
}
