import {
  type FileHandle,
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { join } from 'node:path'

import { type CallJournal, type CallStore, parseCallJournal } from '@dltech/atlas-protocol/engine'

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024

type CallEntry = { dir: string; name: string; mtimeMs: number; bytes: number }

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const writeSynced = async (args: { path: string; content: string }): Promise<void> => {
  let handle: FileHandle | undefined
  try {
    handle = await open(args.path, 'w')
    await handle.writeFile(args.content)
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

const syncDirectory = async (path: string): Promise<void> => {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

export const daemonHomeFromEnv = (env: Record<string, string | undefined>): string => {
  const explicit = env.ATLAS_DAEMON_HOME
  if (explicit !== undefined && explicit !== '') return explicit
  const home = env.HOME
  if (home === undefined || home === '')
    throw new Error('neither ATLAS_DAEMON_HOME nor HOME is set')
  return join(home, '.atlas-daemon')
}

const statOrUndefined = async (path: string) => {
  try {
    return await stat(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

const entryOf = async (args: { dir: string; name: string }): Promise<CallEntry | undefined> => {
  const files = await Promise.all([
    statOrUndefined(join(args.dir, 'state.json')),
    statOrUndefined(join(args.dir, 'output.bin')),
  ])
  const present = files.filter((file) => file !== undefined)
  if (present.length > 0) {
    return {
      ...args,
      mtimeMs: Math.max(...present.map((file) => file.mtimeMs)),
      bytes: present.reduce((sum, file) => sum + file.size, 0),
    }
  }
  const own = await statOrUndefined(args.dir)
  return own === undefined ? undefined : { ...args, mtimeMs: own.mtimeMs, bytes: 0 }
}

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true })

export class DiskCallStore implements CallStore {
  constructor(
    private readonly home: string,
    private readonly limits: { maxAgeMs?: number; maxBytes?: number } = {},
  ) {}

  private dirOf(key: string): string {
    return join(this.home, 'calls', key)
  }

  async prune(): Promise<void> {
    const root = join(this.home, 'calls')
    await mkdir(root, { recursive: true })
    const cutoff = Date.now() - (this.limits.maxAgeMs ?? DEFAULT_MAX_AGE_MS)
    const maxBytes = this.limits.maxBytes ?? DEFAULT_MAX_BYTES
    const names = (await readdir(root, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
    const found = await Promise.all(names.map((name) => entryOf({ dir: join(root, name), name })))
    const entries = found
      .filter((entry) => entry !== undefined)
      .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : 1))
    let total = 0
    let overBudget = false
    for (const [index, entry] of entries.entries()) {
      const keep =
        entry.mtimeMs >= cutoff && !overBudget && (index === 0 || total + entry.bytes <= maxBytes)
      if (keep) {
        total += entry.bytes
        continue
      }
      if (entry.mtimeMs >= cutoff) overBudget = true
      await removeDir(entry.dir)
    }
  }

  async readState(args: { key: string }): Promise<CallJournal | undefined> {
    try {
      const text = await readFile(join(this.dirOf(args.key), 'state.json'), 'utf8')
      return parseCallJournal(JSON.parse(text))
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return undefined
      throw error
    }
  }

  async writeState(args: { key: string; journal: CallJournal }): Promise<void> {
    const dir = this.dirOf(args.key)
    await mkdir(dir, { recursive: true })
    const staging = join(dir, 'state.json.tmp')
    await writeSynced({ path: staging, content: JSON.stringify(args.journal) })
    await rename(staging, join(dir, 'state.json'))
    await syncDirectory(dir)
  }

  async appendOutput(args: { key: string; bytes: Uint8Array }): Promise<void> {
    await appendFile(join(this.dirOf(args.key), 'output.bin'), args.bytes)
  }

  async readOutput(args: { key: string; offset: number }): Promise<Uint8Array> {
    try {
      const bytes = new Uint8Array(await readFile(join(this.dirOf(args.key), 'output.bin')))
      return bytes.subarray(Math.min(args.offset, bytes.length))
    } catch (error) {
      if (isMissing(error)) return new Uint8Array()
      throw error
    }
  }

  async remove(args: { key: string }): Promise<void> {
    await rm(this.dirOf(args.key), { recursive: true, force: true })
  }
}
