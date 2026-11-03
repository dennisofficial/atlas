import { type FileHandle, appendFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { CallJournal, CallStore } from '@dltech/atlas-protocol/engine'

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

/**
 * Call keys reach this store only after the frame schema has restricted them to
 * `[A-Za-z0-9_.:-]` and refused all-dot keys, so a key is always one directory name.
 */
export class DiskCallStore implements CallStore {
  constructor(private readonly home: string) {}

  private dirOf(key: string): string {
    return join(this.home, 'calls', key)
  }

  async prune(): Promise<void> {
    await rm(join(this.home, 'calls'), { recursive: true, force: true })
    await mkdir(join(this.home, 'calls'), { recursive: true })
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
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return new Uint8Array()
      }
      throw error
    }
  }

  async remove(args: { key: string }): Promise<void> {
    await rm(this.dirOf(args.key), { recursive: true, force: true })
  }
}
