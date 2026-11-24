export const SESSION = 'session-context'
export const HEAD_BYTES = 8192
export const ROOT = '/atlas/home/sessions/session-context/context'
export const NOW = 1_700_000_000_000

export type FakeFile = { bytes: Uint8Array; mtimeMs: number; size?: number | undefined }

export type FakeFs = {
  root: string
  files: Map<string, FakeFile>
  dirs: Set<string>
  digests: string[]
  reads: string[]
  scans: number
  failDigests: Set<string>
  failDirs: Set<string>
  failStats: Set<string>
  onScan: (() => void) | undefined
  watchRoots: string[][]
  armed: string[]
  stopped: string[]
  changed: ((event: { watchId: string; paths: string[] }) => void) | undefined
}

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

export const binaryOf = (...values: readonly number[]): Uint8Array => new Uint8Array(values)

export const fakeFs = (): FakeFs => ({
  root: ROOT,
  files: new Map(),
  dirs: new Set([ROOT]),
  digests: [],
  reads: [],
  scans: 0,
  failDigests: new Set(),
  failDirs: new Set(),
  failStats: new Set(),
  onScan: undefined,
  watchRoots: [],
  armed: [],
  stopped: [],
  changed: undefined,
})

const absolute = (fs: FakeFs, path: string): string => `${fs.root}/${path}`

export const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))
const ensureDirectories = (fs: FakeFs, path: string): void => {
  let directory = parentOf(path)
  while (directory.startsWith(fs.root) && !fs.dirs.has(directory)) {
    fs.dirs.add(directory)
    directory = parentOf(directory)
  }
}

export const putFile = (args: {
  fs: FakeFs
  path: string
  bytes?: Uint8Array | undefined
  text?: string | undefined
  mtimeMs?: number | undefined
  size?: number | undefined
}): void => {
  const path = absolute(args.fs, args.path)
  ensureDirectories(args.fs, path)
  args.fs.files.set(path, {
    bytes: args.bytes ?? bytesOf(args.text ?? ''),
    mtimeMs: args.mtimeMs ?? NOW,
    size: args.size,
  })
}

export const removeFile = (args: { fs: FakeFs; path: string }): void => {
  args.fs.files.delete(absolute(args.fs, args.path))
}

export const putDirectory = (args: { fs: FakeFs; path: string }): void => {
  args.fs.dirs.add(absolute(args.fs, args.path))
}

export const announceChanged = (args: {
  fs: FakeFs
  watchId: string
  paths?: readonly string[] | undefined
}): void => {
  args.fs.changed?.({ watchId: args.watchId, paths: [...(args.paths ?? [])] })
}

export const entriesOf = (fs: FakeFs, directory: string) => {
  const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = []
  for (const path of fs.files.keys()) {
    if (parentOf(path) !== directory) continue
    entries.push({ name: path.slice(path.lastIndexOf('/') + 1), isFile: true, isDirectory: false })
  }
  for (const path of fs.dirs) {
    if (path === directory || parentOf(path) !== directory) continue
    entries.push({ name: path.slice(path.lastIndexOf('/') + 1), isFile: false, isDirectory: true })
  }
  return entries
}

export const statOf = (fs: FakeFs, path: string) => {
  const file = fs.files.get(path)
  if (file !== undefined) {
    return {
      size: file.size ?? file.bytes.byteLength,
      mode: 0o644,
      mtimeMs: file.mtimeMs,
      isFile: true,
      isDirectory: false,
    }
  }
  if (!fs.dirs.has(path)) throw new Error(`ENOENT: ${path}`)
  return { size: 0, mode: 0o755, mtimeMs: NOW, isFile: false, isDirectory: true }
}
