import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { captureGit } from './capture-git'
import { walkTree, type SkipRule, type TreeWalk } from './capture-files'

const LOCK_SUFFIX = '.lock'
const FSMONITOR_PREFIX = 'fsmonitor--daemon'
const PARTIAL_PREFIX = 'tmp_'
const GC_PID = 'gc.pid'
const RECEIPT_NAME = 'atlas-transfer.json'

const COMMON_EXCLUDED_ROOTS = new Set(['worktrees', 'index', 'refs', 'packed-refs', 'objects', 'ai', RECEIPT_NAME, GC_PID])
const LINKED_EXCLUDED_ROOTS = new Set(['commondir', 'gitdir', 'index', 'locked'])

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const isTransient = (path: string): boolean => {
  const base = baseOf(path)
  return (
    base.endsWith(LOCK_SUFFIX) || base.startsWith(FSMONITOR_PREFIX) || base.startsWith(PARTIAL_PREFIX)
  )
}

const MAIN_STATE_ROOTS = new Set([
  'HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'MERGE_MSG',
  'MERGE_MODE',
  'AUTO_MERGE',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'SQUASH_MSG',
  'BISECT_LOG',
  'BISECT_START',
  'BISECT_TERMS',
  'BISECT_EXPECTED_REV',
  'BISECT_ANCESTORS_OK',
  'BISECT_NAMES',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
  'config.worktree',
])

const ALTERNATES_PATH = 'objects/info/alternates'

const commonSkip: SkipRule = ({ path }) =>
  isTransient(path) ||
  path === ALTERNATES_PATH ||
  (!path.includes('/') && (COMMON_EXCLUDED_ROOTS.has(path) || MAIN_STATE_ROOTS.has(path)))

const linkedSkip: SkipRule = ({ path }) =>
  isTransient(path) || (!path.includes('/') && LINKED_EXCLUDED_ROOTS.has(path))

const exists = (path: string): Promise<boolean> =>
  stat(path).then(() => true, () => false)

export async function absoluteGitDir({ cwd }: { cwd: string }): Promise<string> {
  const run = await captureGit({ args: ['rev-parse', '--path-format=absolute', '--absolute-git-dir'], cwd })
  const dir = run.stdout.trim()
  if (!run.ok || dir.length === 0) {
    throw new Error(`Cannot locate the git directory of ${cwd}: ${run.stderr.trim()}`)
  }
  return dir
}

export async function absoluteCommonDir({ cwd }: { cwd: string }): Promise<string> {
  const run = await captureGit({ args: ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd })
  const dir = run.stdout.trim()
  if (!run.ok || dir.length === 0) {
    throw new Error(`Cannot locate the common git directory of ${cwd}: ${run.stderr.trim()}`)
  }
  return dir
}

export const collectCommonAdmin = ({ commonDir }: { commonDir: string }): Promise<TreeWalk> =>
  walkTree({ root: commonDir, isSkipped: commonSkip })

const mainStateSkip: SkipRule = ({ path }) =>
  isTransient(path) || !MAIN_STATE_ROOTS.has(path.split('/')[0] ?? path)

export const mainStateRoots = MAIN_STATE_ROOTS

export const collectMainState = ({ gitDir }: { gitDir: string }): Promise<TreeWalk> =>
  walkTree({ root: gitDir, isSkipped: mainStateSkip })

export const collectLinkedState = ({ gitDir }: { gitDir: string }): Promise<TreeWalk> =>
  walkTree({ root: gitDir, isSkipped: linkedSkip })

export const indexPathIfPresent = async ({ gitDir }: { gitDir: string }): Promise<string | null> => {
  const path = join(gitDir, 'index')
  return (await exists(path)) ? path : null
}

const DIGEST_COMMON_ROOTS = new Set(['config', 'shallow', 'info'])

const volatileRoot = (path: string): boolean => {
  const root = path.split('/')[0] ?? path
  return root === 'logs' || root.startsWith('sharedindex.')
}

export const commonDigestSkip: SkipRule = ({ path }) =>
  isTransient(path) || !DIGEST_COMMON_ROOTS.has(path.split('/')[0] ?? path)

export const stateDigestSkip = ({ isMain }: { isMain: boolean }): SkipRule => {
  const base = isMain ? mainStateSkip : linkedSkip
  return (args) => volatileRoot(args.path) || base(args)
}
