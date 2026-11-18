import { type FSWatcher, existsSync, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

const MAX_DEPTH = 4
const DEBOUNCE_MS = 400
const SKIPPED = new Set(['.git', 'node_modules'])

export type RepoScan = { repos: readonly string[]; dirs: readonly string[] }

const isRepoDir = async (dir: string): Promise<boolean> => {
  try {
    await stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

const childDirectoriesOf = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return [...entries]
    .filter((entry) => entry.isDirectory() && !SKIPPED.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => join(dir, entry.name))
}

export const scanRepos = async (args: { root: string; maxDepth?: number }): Promise<RepoScan> => {
  const maxDepth = args.maxDepth ?? MAX_DEPTH
  const repos: string[] = []
  const dirs: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (await isRepoDir(dir)) {
      repos.push(dir)
      return
    }
    dirs.push(dir)
    if (depth >= maxDepth) return
    for (const child of await childDirectoriesOf(dir)) await visit(child, depth + 1)
  }
  await visit(args.root, 0)
  return { repos, dirs }
}

const nearestExisting = (path: string): string => {
  let current = dirname(path)
  while (current !== dirname(current)) {
    if (existsSync(current)) return current
    current = dirname(current)
  }
  return current
}

export class RepoDiscovery {
  private readonly root: string
  private readonly onFound: (repoPath: string) => void
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly repos = new Set<string>()
  private pending: ReturnType<typeof setTimeout> | null = null
  private scanning = false
  private again = false
  private stopped = false

  constructor(args: { root: string; onFound: (repoPath: string) => void }) {
    this.root = args.root
    this.onFound = args.onFound
  }

  async start(): Promise<readonly string[]> {
    this.absorb(await scanRepos({ root: this.root }), false)
    return [...this.repos].sort()
  }

  stop(): void {
    this.stopped = true
    if (this.pending !== null) clearTimeout(this.pending)
    this.pending = null
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private absorb(scan: RepoScan, notify: boolean): void {
    this.arm(scan.dirs)
    for (const repo of scan.repos) {
      if (this.repos.has(repo)) continue
      this.repos.add(repo)
      if (notify) this.onFound(repo)
    }
  }

  private arm(dirs: readonly string[]): void {
    const targets = new Set([this.root, ...dirs])
    for (const [dir, watcher] of [...this.watchers]) {
      if (!this.within(dir) || targets.has(dir)) continue
      watcher.close()
      this.watchers.delete(dir)
    }
    for (const dir of targets) this.armOne(dir)
  }

  private within(dir: string): boolean {
    return dir === this.root || dir.startsWith(`${this.root}${sep}`)
  }

  private armOne(dir: string): void {
    if (this.watchers.has(dir)) return
    try {
      this.watchers.set(
        dir,
        watch(dir, { persistent: true, recursive: false }, () => this.schedule()),
      )
    } catch {
      this.armAncestor()
    }
  }

  private armAncestor(): void {
    const ancestor = nearestExisting(this.root)
    if (ancestor === this.root) return
    this.armOne(ancestor)
  }

  private schedule(): void {
    if (this.stopped) return
    if (this.pending !== null) clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      this.pending = null
      void this.rescan()
    }, DEBOUNCE_MS)
  }

  private async rescan(): Promise<void> {
    if (this.stopped) return
    if (this.scanning) {
      this.again = true
      return
    }
    this.scanning = true
    try {
      this.absorb(await scanRepos({ root: this.root }), true)
    } catch {
      this.again = false
    } finally {
      this.scanning = false
    }
    if (this.again) {
      this.again = false
      this.schedule()
    }
  }
}
