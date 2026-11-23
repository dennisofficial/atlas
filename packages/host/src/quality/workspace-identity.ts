import { dirname, relative, resolve } from 'node:path'

import {
  normalizeRepoOrigin,
  type ProcessPort,
  type ThreadId,
  WorkspaceIdentityPort,
} from '@dltech/atlas-core'
import { WORKSPACE_IDENTITY_TIMEOUT_MS } from '@dltech/atlas-quality'

import {
  EProbeScope,
  EProbeSection,
  requiredSection,
  runProbe,
  type ProbeSections,
} from './workspace-identity-probe'

const MAX_TIMEOUT_MS = 1_000
const MAX_CACHED_LAYOUTS = 64
const NOT_FOUND_EXIT_CODE = 1
const DETACHED_BRANCH = 'HEAD'
const MAIN_WORKTREE_PATH = '.'

type WorktreeEntry = { path: string; bare: boolean }

type WorkspaceIdentity = Awaited<ReturnType<WorkspaceIdentityPort['identify']>>

type RepositoryLayout = { relativePath: string; localRemote: string | null }

const unidentified = (): WorkspaceIdentity => ({ remote: null, worktreePath: null })

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '')

const boundedTimeout = (timeoutMs: number): number =>
  Math.min(Math.max(Math.floor(timeoutMs), 1), MAX_TIMEOUT_MS)

function parseWorktrees(stdout: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null
  for (const field of stdout.split('\0')) {
    if (field === '' || field.startsWith('worktree ')) {
      if (current !== null) entries.push(current)
      current = field === '' ? null : { path: field.slice('worktree '.length), bare: false }
      continue
    }
    if (field === 'bare' && current !== null) current.bare = true
  }
  if (current !== null) entries.push(current)
  return entries
}

const isInside = ({ directory, path }: { directory: string; path: string }): boolean => {
  const offset = relative(directory, path)
  return offset !== '' && offset !== '..' && !offset.startsWith('../')
}

const anchorBesideGitDirectory = ({
  gitDirectory,
  toplevel,
}: {
  gitDirectory: string
  toplevel: string
}): string =>
  isInside({ directory: gitDirectory, path: toplevel }) ? gitDirectory : dirname(gitDirectory)

const ATLAS_WORKTREE_MARKER = '/.atlas/worktrees/'

const anchorLinkedWorktree = (toplevel: string): string => {
  const marker = toplevel.indexOf(ATLAS_WORKTREE_MARKER)
  return marker > 0 ? toplevel.slice(0, marker) : dirname(toplevel)
}

function readConfiguredWorkTree({
  sections,
  commonDir,
}: {
  sections: ProbeSections
  commonDir: string
}): string | null {
  const configured = requiredSection({ sections, name: EProbeSection.WorktreeConfig })
  if (configured.exitCode === NOT_FOUND_EXIT_CODE) return null
  if (configured.exitCode !== 0)
    throw new Error(`git config failed (git exit ${configured.exitCode})`)
  const [path] = linesOf(configured.stdout)
  return path === undefined ? null : resolve(commonDir, path)
}

function resolveMainRoot(args: {
  sections: ProbeSections
  toplevel: string
  commonDir: string
  worktrees: readonly WorktreeEntry[]
}): string {
  const [primary, ...linked] = args.worktrees
  if (primary === undefined) throw new Error('git listed no worktrees for this repository')
  if (primary.bare)
    return anchorBesideGitDirectory({ gitDirectory: primary.path, toplevel: args.toplevel })
  if (resolve(primary.path) !== args.commonDir) return primary.path

  const configured = readConfiguredWorkTree({ sections: args.sections, commonDir: args.commonDir })
  if (configured !== null) return configured
  if (linked.every((entry) => entry.path !== args.toplevel)) return args.toplevel
  return anchorLinkedWorktree(args.toplevel)
}

function layoutOf(sections: ProbeSections): RepositoryLayout | null {
  const paths = requiredSection({ sections, name: EProbeSection.Paths })
  if (paths.exitCode !== 0) {
    throw new Error(`workspace is not a readable git work tree (git exit ${paths.exitCode})`)
  }
  const [toplevel, commonDir, shallow] = linesOf(paths.stdout)
  if (toplevel === undefined || commonDir === undefined || shallow === undefined) {
    throw new Error('git returned an unreadable repository layout')
  }

  const listed = requiredSection({ sections, name: EProbeSection.Worktrees })
  if (listed.exitCode !== 0)
    throw new Error(`git worktree list failed (git exit ${listed.exitCode})`)
  const mainRoot = resolveMainRoot({
    sections,
    toplevel,
    commonDir,
    worktrees: parseWorktrees(listed.stdout),
  })

  const roots = requiredSection({ sections, name: EProbeSection.Roots })
  if (roots.exitCode !== 0) return null
  const [rootCommit] = linesOf(roots.stdout).sort()
  if (rootCommit === undefined) return null

  const relativePath = relative(mainRoot, toplevel)
  return {
    relativePath: relativePath === '' ? MAIN_WORKTREE_PATH : relativePath,
    localRemote: shallow === 'true' ? null : `local:${rootCommit}`,
  }
}

function originOf(sections: ProbeSections): string | null {
  const origin = requiredSection({ sections, name: EProbeSection.Origin })
  if (origin.exitCode === NOT_FOUND_EXIT_CODE) return null
  if (origin.exitCode !== 0) throw new Error(`git config failed (git exit ${origin.exitCode})`)
  const [url] = linesOf(origin.stdout)
  return url === undefined ? null : normalizeRepoOrigin(url)
}

function branchOf(sections: ProbeSections): string {
  const branch = requiredSection({ sections, name: EProbeSection.Branch })
  if (branch.exitCode === NOT_FOUND_EXIT_CODE) return DETACHED_BRANCH
  if (branch.exitCode !== 0)
    throw new Error(`git symbolic-ref failed (git exit ${branch.exitCode})`)
  const [name] = linesOf(branch.stdout)
  return name ?? DETACHED_BRANCH
}

export class DaemonWorkspaceIdentity extends WorkspaceIdentityPort {
  private readonly process: ProcessPort
  private readonly timeoutMs: number
  private readonly layouts = new Map<string, RepositoryLayout>()

  constructor({
    process,
    timeoutMs = WORKSPACE_IDENTITY_TIMEOUT_MS,
  }: { process: ProcessPort; timeoutMs?: number }) {
    super()
    this.process = process
    this.timeoutMs = boundedTimeout(timeoutMs)
  }

  async identify({
    projectDirectory,
    threadId,
  }: {
    projectDirectory: string
    threadId: ThreadId
  }): Promise<WorkspaceIdentity> {
    const key = `${threadId}\0${projectDirectory}`
    const cached = this.layouts.get(key)
    const sections = await runProbe({
      process: this.process,
      cwd: projectDirectory,
      threadId,
      timeoutMs: this.timeoutMs,
      scope: cached === undefined ? EProbeScope.Layout : EProbeScope.Refs,
    })
    const layout = cached ?? layoutOf(sections)
    if (layout === null) return unidentified()
    this.remember({ key, layout })

    const remote = originOf(sections) ?? layout.localRemote
    if (remote === null) return unidentified()
    return { remote, worktreePath: `${branchOf(sections)}:${layout.relativePath}` }
  }

  private remember({ key, layout }: { key: string; layout: RepositoryLayout }): void {
    if (this.layouts.has(key)) return
    if (this.layouts.size >= MAX_CACHED_LAYOUTS) {
      const oldest = this.layouts.keys().next().value
      if (oldest !== undefined) this.layouts.delete(oldest)
    }
    this.layouts.set(key, layout)
  }
}
