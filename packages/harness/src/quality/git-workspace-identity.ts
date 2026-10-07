import { dirname, relative, resolve } from 'node:path'

import {
  normalizeRepoOrigin,
  type ProcessHandle,
  type ProcessPort,
  type ThreadId,
  type WorkspaceIdentityPort,
} from '@dltech/atlas-core'

export const WORKSPACE_IDENTITY_TIMEOUT_MS = 750

const MAX_TIMEOUT_MS = 1_000
const MAX_CACHED_LAYOUTS = 64
const NOT_FOUND_EXIT_CODE = 1
const DETACHED_BRANCH = 'HEAD'
const MAIN_WORKTREE_PATH = '.'

export class WorkspaceIdentityDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`workspace identity probe exceeded ${timeoutMs}ms`)
    this.name = 'WorkspaceIdentityDeadlineError'
  }
}

type WorktreeEntry = { path: string; bare: boolean }

type WorkspaceIdentity = Awaited<ReturnType<WorkspaceIdentityPort['identify']>>

type GitOutput = { exitCode: number; stdout: string }

type RepositoryLayout = { relativePath: string; localRemote: string | null }

const unidentified = (): WorkspaceIdentity => ({ remote: null, worktreePath: null })

const linesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '')

const boundedTimeout = (timeoutMs: number): number =>
  Math.min(Math.max(Math.floor(timeoutMs), 1), MAX_TIMEOUT_MS)

const discard = (stream: ReadableStream<Uint8Array>): Promise<void> =>
  new Response(stream).text().then(() => undefined)

class GitProbe {
  private readonly running = new Set<ProcessHandle>()
  private readonly expired: Promise<never>
  private timer: ReturnType<typeof setTimeout> | undefined
  private timedOut = false

  constructor(
    private readonly args: {
      process: ProcessPort
      cwd: string
      threadId: ThreadId
      timeoutMs: number
    },
  ) {
    this.expired = new Promise<never>((_, reject) => {
      this.timer = setTimeout(() => {
        this.timedOut = true
        this.terminateRunning()
        reject(new WorkspaceIdentityDeadlineError(args.timeoutMs))
      }, args.timeoutMs)
    })
    this.expired.catch(() => undefined)
  }

  async run(gitArgs: readonly string[]): Promise<GitOutput> {
    if (this.timedOut) throw new WorkspaceIdentityDeadlineError(this.args.timeoutMs)
    const handle = this.args.process.spawn({
      cmd: ['git', ...gitArgs],
      cwd: this.args.cwd,
      threadId: this.args.threadId,
    })
    this.running.add(handle)
    const collected = Promise.all([
      new Response(handle.stdout).text(),
      handle.exited,
      discard(handle.stderr),
    ])
    collected.catch(() => undefined)
    try {
      const [stdout, exitCode] = await Promise.race([collected, this.expired])
      return { exitCode, stdout }
    } finally {
      this.running.delete(handle)
    }
  }

  close(): void {
    clearTimeout(this.timer)
    this.terminateRunning()
  }

  private terminateRunning(): void {
    for (const handle of this.running) {
      try {
        handle.terminate()
      } catch {
        continue
      }
    }
    this.running.clear()
  }
}

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

const anchorBesideGitDirectory = ({ gitDirectory, toplevel }: { gitDirectory: string; toplevel: string }): string =>
  isInside({ directory: gitDirectory, path: toplevel }) ? gitDirectory : dirname(gitDirectory)

const ATLAS_WORKTREE_MARKER = '/.atlas/worktrees/'

const anchorLinkedWorktree = (toplevel: string): string => {
  const marker = toplevel.indexOf(ATLAS_WORKTREE_MARKER)
  return marker > 0 ? toplevel.slice(0, marker) : dirname(toplevel)
}

async function readConfiguredWorkTree({ probe, commonDir }: { probe: GitProbe; commonDir: string }): Promise<string | null> {
  const configured = await probe.run(['config', '--get', 'core.worktree'])
  if (configured.exitCode === NOT_FOUND_EXIT_CODE) return null
  if (configured.exitCode !== 0) throw new Error(`git config failed (git exit ${configured.exitCode})`)
  const [path] = linesOf(configured.stdout)
  return path === undefined ? null : resolve(commonDir, path)
}

async function resolveMainRoot(args: {
  probe: GitProbe
  toplevel: string
  commonDir: string
  worktrees: readonly WorktreeEntry[]
}): Promise<string> {
  const [primary, ...linked] = args.worktrees
  if (primary === undefined) throw new Error('git listed no worktrees for this repository')
  if (primary.bare) return anchorBesideGitDirectory({ gitDirectory: primary.path, toplevel: args.toplevel })
  if (resolve(primary.path) !== args.commonDir) return primary.path

  const configured = await readConfiguredWorkTree({ probe: args.probe, commonDir: args.commonDir })
  if (configured !== null) return configured
  if (linked.every((entry) => entry.path !== args.toplevel)) return args.toplevel
  return anchorLinkedWorktree(args.toplevel)
}

async function readLayout(probe: GitProbe): Promise<RepositoryLayout | null> {
  const paths = await probe.run([
    'rev-parse',
    '--show-toplevel',
    '--path-format=absolute',
    '--git-common-dir',
    '--is-shallow-repository',
  ])
  if (paths.exitCode !== 0) {
    throw new Error(`workspace is not a readable git work tree (git exit ${paths.exitCode})`)
  }
  const [toplevel, commonDir, shallow] = linesOf(paths.stdout)
  if (toplevel === undefined || commonDir === undefined || shallow === undefined) {
    throw new Error('git returned an unreadable repository layout')
  }

  const listed = await probe.run(['worktree', 'list', '--porcelain', '-z'])
  if (listed.exitCode !== 0) throw new Error(`git worktree list failed (git exit ${listed.exitCode})`)
  const mainRoot = await resolveMainRoot({ probe, toplevel, commonDir, worktrees: parseWorktrees(listed.stdout) })

  const roots = await probe.run(['rev-list', '--max-parents=0', 'HEAD'])
  if (roots.exitCode !== 0) return null
  const [rootCommit] = linesOf(roots.stdout).sort()
  if (rootCommit === undefined) return null

  const relativePath = relative(mainRoot, toplevel)
  return {
    relativePath: relativePath === '' ? MAIN_WORKTREE_PATH : relativePath,
    localRemote: shallow === 'true' ? null : `local:${rootCommit}`,
  }
}

async function readNormalizedOrigin(probe: GitProbe): Promise<string | null> {
  const origin = await probe.run(['config', '--get', 'remote.origin.url'])
  if (origin.exitCode === NOT_FOUND_EXIT_CODE) return null
  if (origin.exitCode !== 0) throw new Error(`git config failed (git exit ${origin.exitCode})`)
  const [url] = linesOf(origin.stdout)
  return url === undefined ? null : normalizeRepoOrigin(url)
}

async function readBranch(probe: GitProbe): Promise<string> {
  const branch = await probe.run(['symbolic-ref', '--short', '-q', 'HEAD'])
  if (branch.exitCode === NOT_FOUND_EXIT_CODE) return DETACHED_BRANCH
  if (branch.exitCode !== 0) throw new Error(`git symbolic-ref failed (git exit ${branch.exitCode})`)
  const [name] = linesOf(branch.stdout)
  return name ?? DETACHED_BRANCH
}

export class GitWorkspaceIdentity implements WorkspaceIdentityPort {
  private readonly process: ProcessPort
  private readonly timeoutMs: number
  private readonly layouts = new Map<string, RepositoryLayout>()

  constructor({ process, timeoutMs = WORKSPACE_IDENTITY_TIMEOUT_MS }: { process: ProcessPort; timeoutMs?: number }) {
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
    const probe = new GitProbe({
      process: this.process,
      cwd: projectDirectory,
      threadId,
      timeoutMs: this.timeoutMs,
    })
    try {
      const key = `${threadId}\0${projectDirectory}`
      const layout = this.layouts.get(key) ?? (await readLayout(probe))
      if (layout === null) return unidentified()
      this.remember({ key, layout })

      const [origin, branch] = await Promise.all([readNormalizedOrigin(probe), readBranch(probe)])
      const remote = origin ?? layout.localRemote
      if (remote === null) return unidentified()
      return { remote, worktreePath: `${branch}:${layout.relativePath}` }
    } finally {
      probe.close()
    }
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
