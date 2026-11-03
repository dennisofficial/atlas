import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  ATLAS_HOME_MOUNT_PREFIX,
  EFileMountTarget,
  fileMountPathProblem,
  fileMountRelativePathOf,
  fileMountTargetOf,
  type ScopedFileMount,
} from '@dltech/atlas-wire/web'

const OWNER_ONLY = 0o600

export enum EFileMountState {
  Written = 'written',
  WrittenLocallyExcluded = 'written-locally-excluded',
  WrittenNotExcluded = 'written-not-excluded',
  SkippedTracked = 'skipped-tracked',
  SkippedNoRepository = 'skipped-no-repository',
  Failed = 'failed',
}

export type FileMountOutcome = { path: string; state: EFileMountState; reason?: string }

export type FileMountReport = { outcomes: FileMountOutcome[] }

export type FileMountRoots = {
  repositoryDir: string | null
  homeDir: string
  atlasHomeDir?: string | undefined
}

export type ManagedSkillPrefixes = {
  globalPrefix: string
  projectPrefix: string
}

export type FileMountGit = (args: {
  cwd: string
  argv: string[]
}) => Promise<{ exitCode: number; stdout: string }>

const bunGit: FileMountGit = async ({ cwd, argv }) => {
  const child = Bun.spawn(['git', ...argv], { cwd, stdout: 'pipe', stderr: 'ignore' })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return { exitCode, stdout }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'it failed for a reason it did not name'

const isInside = (args: { root: string; target: string }): boolean => {
  const path = relative(args.root, args.target)
  const [firstSegment] = path.split(sep)
  return path === '' || (path !== '..' && firstSegment !== '..' && !isAbsolute(path))
}

const nearestExisting = (path: string): string => {
  let current = path
  while (!existsSync(current)) current = dirname(current)
  return current
}

const confinedTarget = (args: { root: string; relativePath: string }): string => {
  mkdirSync(args.root, { recursive: true })
  const target = resolve(args.root, args.relativePath)
  if (!isInside({ root: args.root, target })) throw new Error('the path leaves its folder')
  const realRoot = realpathSync(args.root)
  const realParent = realpathSync(nearestExisting(dirname(target)))
  if (!isInside({ root: realRoot, target: realParent })) {
    throw new Error('a parent folder is a link that leaves its folder')
  }
  return target
}

const mountedContents = (mount: ScopedFileMount): string | Uint8Array<ArrayBuffer> =>
  mount.encoding === 'base64' ? Buffer.from(mount.contents, 'base64') : mount.contents

const writeMounted = (args: {
  target: string
  contents: string | Uint8Array<ArrayBuffer>
  mode: number
}): void => {
  mkdirSync(dirname(args.target), { recursive: true })
  const staging = join(dirname(args.target), `.${randomBytes(8).toString('hex')}.tmp`)
  try {
    writeFileSync(staging, args.contents, { mode: OWNER_ONLY })
    chmodSync(staging, args.mode)
    renameSync(staging, args.target)
  } catch (failure) {
    rmSync(staging, { force: true })
    throw failure
  }
}

const sweepManagedPrefix = (args: {
  root: string
  prefix: string
  keptRelativePaths: ReadonlySet<string>
}): void => {
  const directory = resolve(args.root, args.prefix)
  if (!isInside({ root: args.root, target: directory })) return
  const walk = (current: string): void => {
    if (!existsSync(current)) return
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        walk(path)
        if (readdirSync(path).length === 0) rmSync(path, { recursive: true })
        continue
      }
      const relativePath = relative(args.root, path)
      if (!args.keptRelativePaths.has(relativePath)) rmSync(path, { force: true })
    }
  }
  walk(directory)
}

const sweepManagedDirectories = (args: {
  mounts: readonly ScopedFileMount[]
  prefixes: ManagedSkillPrefixes
  atlasHomeDir: string | undefined
}): void => {
  if (args.atlasHomeDir === undefined) return
  const atlasMounts = args.mounts.filter((mount) => mount.path.startsWith(ATLAS_HOME_MOUNT_PREFIX))
  const kept = new Set(atlasMounts.map((mount) => fileMountRelativePathOf(mount.path)))
  for (const prefix of [args.prefixes.globalPrefix, args.prefixes.projectPrefix]) {
    sweepManagedPrefix({ root: args.atlasHomeDir, prefix, keptRelativePaths: kept })
  }
}

const excludeLineOf = (relativePath: string): string => {
  const escaped = relativePath
    .replace(/[\\*?[]/g, (character) => `\\${character}`)
    .replace(/^[#!]/, (character) => `\\${character}`)
    .replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))
  return `/${escaped}`
}

const excludeFileOf = async (args: { repositoryDir: string; git: FileMountGit }) => {
  const run = await args.git({
    cwd: args.repositoryDir,
    argv: ['rev-parse', '--git-path', 'info/exclude'],
  })
  if (run.exitCode !== 0) throw new Error('git did not name its exclude file')
  return resolve(args.repositoryDir, run.stdout.trim())
}

const excludeLocally = async (args: {
  repositoryDir: string
  relativePath: string
  git: FileMountGit
}): Promise<void> => {
  const file = await excludeFileOf(args)
  const line = excludeLineOf(args.relativePath)
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (existing.split('\n').some((entry) => entry.replace(/\r$/, '') === line)) return
  mkdirSync(dirname(file), { recursive: true })
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  appendFileSync(file, `${separator}${line}\n`)
}

const isWorkTree = async (args: { cwd: string; git: FileMountGit }): Promise<boolean> => {
  const run = await args.git({ cwd: args.cwd, argv: ['rev-parse', '--is-inside-work-tree'] })
  return run.exitCode === 0
}

const mountOne = async (args: {
  mount: ScopedFileMount
  roots: FileMountRoots
  git: FileMountGit
}): Promise<FileMountOutcome> => {
  const { path, mode } = args.mount
  const problem = fileMountPathProblem(path)
  if (problem !== null) return { path, state: EFileMountState.Failed, reason: problem }
  const relativePath = fileMountRelativePathOf(path)
  const isHome = fileMountTargetOf(path) === EFileMountTarget.Home
  const isAtlasHome = path.startsWith(ATLAS_HOME_MOUNT_PREFIX)
  if (isAtlasHome && args.roots.atlasHomeDir === undefined) {
    return { path, state: EFileMountState.Failed, reason: 'no atlas home is mounted' }
  }
  const root = isAtlasHome
    ? (args.roots.atlasHomeDir ?? args.roots.homeDir)
    : isHome
      ? args.roots.homeDir
      : args.roots.repositoryDir
  if (root === null) return { path, state: EFileMountState.SkippedNoRepository }
  const contents = mountedContents(args.mount)
  try {
    if (!isHome && !(await isWorkTree({ cwd: root, git: args.git }))) {
      return { path, state: EFileMountState.SkippedNoRepository }
    }
    const target = confinedTarget({ root, relativePath })
    if (isHome) {
      writeMounted({ target, contents, mode })
      return { path, state: EFileMountState.Written }
    }
    const tracked = await args.git({
      cwd: root,
      argv: ['ls-files', '--error-unmatch', '--', relativePath],
    })
    if (tracked.exitCode > 1) throw new Error('git could not check whether the path is tracked')
    if (tracked.exitCode === 0) return { path, state: EFileMountState.SkippedTracked }
    const ignored = await args.git({ cwd: root, argv: ['check-ignore', '-q', '--', relativePath] })
    if (ignored.exitCode > 1) throw new Error('git could not check whether the path is ignored')
    writeMounted({ target, contents, mode })
    if (ignored.exitCode === 0) return { path, state: EFileMountState.Written }
    try {
      await excludeLocally({ repositoryDir: root, relativePath, git: args.git })
    } catch (failure) {
      return { path, state: EFileMountState.WrittenNotExcluded, reason: messageOf(failure) }
    }
    return { path, state: EFileMountState.WrittenLocallyExcluded }
  } catch (failure) {
    return { path, state: EFileMountState.Failed, reason: messageOf(failure) }
  }
}

export const mountProjectFiles = async (args: {
  mounts: readonly ScopedFileMount[]
  repositoryDir: string | null
  homeDir: string
  atlasHomeDir?: string | undefined
  managedPrefixes?: ManagedSkillPrefixes | undefined
  git?: FileMountGit | undefined
}): Promise<FileMountReport> => {
  const git = args.git ?? bunGit
  const roots = {
    repositoryDir: args.repositoryDir,
    homeDir: args.homeDir,
    atlasHomeDir: args.atlasHomeDir,
  }
  const outcomes: FileMountOutcome[] = []
  for (const mount of args.mounts) outcomes.push(await mountOne({ mount, roots, git }))
  if (args.managedPrefixes !== undefined) {
    sweepManagedDirectories({
      mounts: args.mounts,
      prefixes: args.managedPrefixes,
      atlasHomeDir: args.atlasHomeDir,
    })
  }
  return { outcomes }
}
