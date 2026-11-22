import { type FSWatcher, readdirSync, statSync, watch } from 'node:fs'
import { join, sep } from 'node:path'

export const SKIPPED_DIRS: ReadonlySet<string> = new Set(['node_modules'])

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const entriesOf = (dir: string): { dirs: string[]; files: string[] } => {
  const dirs: string[] = []
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) dirs.push(join(dir, entry.name))
        continue
      }
      files.push(join(dir, entry.name))
    }
  } catch {
    return { dirs, files }
  }
  return { dirs, files }
}

export const guardedWatch = (args: {
  path: string
  recursive: boolean
  onEvent: (filename: string | null) => void
  onError: (error: unknown) => void
}): FSWatcher | null => {
  try {
    const watcher = watch(
      args.path,
      { persistent: true, recursive: args.recursive },
      (_event, filename) => args.onEvent(filename),
    )
    watcher.on('error', (error) => {
      watcher.close()
      args.onError(error)
    })
    return watcher
  } catch (error) {
    args.onError(error)
    return null
  }
}

export class TreeWatch {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly root: string
  private readonly onChange: (path: string) => void
  private readonly onError: (error: unknown) => void
  private closed = false

  constructor(args: {
    root: string
    onChange: (path: string) => void
    onError: (error: unknown) => void
  }) {
    this.root = args.root
    this.onChange = args.onChange
    this.onError = args.onError
  }

  start(): void {
    this.armTree({ dir: this.root, report: false })
  }

  close(): void {
    this.closed = true
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private armTree(args: { dir: string; report: boolean }): void {
    const queue = [args.dir]
    while (queue.length > 0 && !this.closed) {
      const dir = queue.shift()
      if (dir === undefined || this.watchers.has(dir)) continue
      if (!this.armOne(dir)) return
      const { dirs, files } = entriesOf(dir)
      if (args.report) for (const path of [...dirs, ...files]) this.onChange(path)
      queue.push(...dirs)
    }
  }

  private armOne(dir: string): boolean {
    const watcher = guardedWatch({
      path: dir,
      recursive: false,
      onEvent: (filename) => this.handleEvent({ dir, filename }),
      onError: (error) => {
        this.watchers.delete(dir)
        this.onError(error)
      },
    })
    if (watcher === null) return false
    this.watchers.set(dir, watcher)
    return true
  }

  private handleEvent(args: { dir: string; filename: string | null }): void {
    if (this.closed) return
    const path = args.filename === null ? args.dir : join(args.dir, args.filename)
    this.onChange(path)
    if (path === args.dir) return
    if (isDirectory(path)) {
      if (!SKIPPED_DIRS.has(args.filename ?? '')) this.armTree({ dir: path, report: true })
      return
    }
    if (this.watchers.has(path)) this.disarmTree(path)
  }

  private disarmTree(path: string): void {
    for (const [dir, watcher] of [...this.watchers]) {
      if (dir !== path && !dir.startsWith(`${path}${sep}`)) continue
      watcher.close()
      this.watchers.delete(dir)
    }
  }
}
