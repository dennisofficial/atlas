export type MemoryEntry =
  | { type: 'file'; bytes: Uint8Array; mode: number; mtimeMs: number }
  | { type: 'dir'; mode: number; mtimeMs: number }

const fsError = (args: { code: string; path: string }): Error =>
  Object.assign(new Error(`${args.code}: ${args.path}`), { code: args.code })

export class MemoryFileSystem {
  private readonly entries = new Map<string, MemoryEntry>()

  constructor() {
    this.entries.set('/', { type: 'dir', mode: 0o755, mtimeMs: 0 })
  }

  stat(args: { path: string }): {
    size: number
    mode: number
    mtimeMs: number
    isFile: boolean
    isDirectory: boolean
  } {
    const entry = this.entries.get(args.path)
    if (entry === undefined) throw fsError({ code: 'ENOENT', path: args.path })
    return {
      size: entry.type === 'file' ? entry.bytes.length : 0,
      mode: entry.mode,
      mtimeMs: entry.mtimeMs,
      isFile: entry.type === 'file',
      isDirectory: entry.type === 'dir',
    }
  }

  readBytes(args: { path: string }): Uint8Array {
    const entry = this.entries.get(args.path)
    if (entry === undefined) throw fsError({ code: 'ENOENT', path: args.path })
    if (entry.type !== 'file') throw fsError({ code: 'EISDIR', path: args.path })
    return entry.bytes
  }

  writeFile(args: { path: string; content: Uint8Array; mode?: number | undefined }): void {
    this.entries.set(args.path, {
      type: 'file',
      bytes: new Uint8Array(args.content),
      mode: args.mode ?? 0o644,
      mtimeMs: 1,
    })
  }

  remove(args: { path: string }): void {
    this.entries.delete(args.path)
    const prefix = `${args.path}/`
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  mkdir(args: { path: string }): void {
    this.entries.set(args.path, { type: 'dir', mode: 0o755, mtimeMs: 1 })
  }

  rename(args: { from: string; to: string }): void {
    const entry = this.entries.get(args.from)
    if (entry === undefined) throw fsError({ code: 'ENOENT', path: args.from })
    this.entries.delete(args.from)
    this.entries.set(args.to, entry)
  }

  exists(args: { path: string }): boolean {
    return this.entries.has(args.path)
  }

  readDirectory(args: { path: string }): { name: string; isFile: boolean; isDirectory: boolean }[] {
    const dir = this.entries.get(args.path)
    if (dir === undefined) throw fsError({ code: 'ENOENT', path: args.path })
    if (dir.type !== 'dir') throw fsError({ code: 'ENOTDIR', path: args.path })
    const prefix = args.path === '/' ? '/' : `${args.path}/`
    const found = new Map<string, { isFile: boolean; isDirectory: boolean }>()
    for (const [path, entry] of this.entries) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest === '' || rest.includes('/')) continue
      found.set(rest, { isFile: entry.type === 'file', isDirectory: entry.type === 'dir' })
    }
    return [...found.entries()].map(([name, kinds]) => ({ name, ...kinds }))
  }

  glob(args: { pattern: string; cwd: string; dot?: boolean | undefined }): string[] {
    const regex = globToRegExp(args.pattern)
    const prefix = args.cwd === '/' ? '/' : `${args.cwd}/`
    const found: string[] = []
    for (const path of this.entries.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest === '') continue
      if (args.dot !== true && rest.split('/').some((part) => part.startsWith('.'))) continue
      if (regex.test(rest)) found.push(rest)
      else if (regex.test(path)) found.push(rest)
    }
    return found.sort()
  }
}

const globToRegExp = (pattern: string): RegExp => {
  let source = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index] ?? ''
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 2
        if (pattern[index] === '/') index += 1
      } else {
        source += '[^/]*'
        index += 1
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      index += 1
      continue
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    index += 1
  }
  return new RegExp(`^${source}$`)
}
