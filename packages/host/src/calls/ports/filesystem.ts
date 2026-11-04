import { FileSystemPort, type FileStat, type FileSystemEntry } from '@dltech/atlas-core'

import type { RemoteCalls } from '../remote-calls'
import { invoke } from './results'

export type DaemonFileSystemArgs = { calls: RemoteCalls }

const statOf = (value: {
  size: number
  mode: number
  mtimeMs: number
  isFile: boolean
  isDirectory: boolean
}): FileStat => ({
  size: value.size,
  mode: value.mode,
  mtimeMs: value.mtimeMs,
  isFile: () => value.isFile,
  isDirectory: () => value.isDirectory,
})

const entryOf = (value: {
  name: string
  isFile: boolean
  isDirectory: boolean
}): FileSystemEntry => ({
  name: value.name,
  isFile: () => value.isFile,
  isDirectory: () => value.isDirectory,
})

export class DaemonFileSystemPort extends FileSystemPort {
  constructor(protected readonly args: DaemonFileSystemArgs) {
    super()
  }

  async stat(args: { path: string }): Promise<FileStat> {
    return statOf(await invoke({ calls: this.args.calls, op: { op: 'stat', path: args.path } }))
  }

  async readLink(args: { path: string }): Promise<string | null> {
    return await invoke({ calls: this.args.calls, op: { op: 'readLink', path: args.path } }).catch(
      (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
        throw error
      },
    )
  }

  async readFile(args: { path: string }): Promise<string> {
    return await invoke({ calls: this.args.calls, op: { op: 'readFile', path: args.path } })
  }

  async readBytes(args: { path: string }): Promise<Uint8Array> {
    const base64 = await invoke({
      calls: this.args.calls,
      op: { op: 'readBytes', path: args.path },
    })
    return new Uint8Array(Buffer.from(base64, 'base64'))
  }

  async readTextForEdit(args: { path: string }): Promise<{ text: string; strict: string | null }> {
    return await invoke({
      calls: this.args.calls,
      op: { op: 'readTextForEdit', path: args.path },
    })
  }

  async writeFile(args: { path: string; content: string; mode?: number }): Promise<void> {
    await invoke({
      calls: this.args.calls,
      op: {
        op: 'writeFile',
        path: args.path,
        content: args.content,
        ...(args.mode === undefined ? {} : { mode: args.mode }),
      },
    })
  }

  async removeFile(args: { path: string }): Promise<void> {
    await invoke({ calls: this.args.calls, op: { op: 'remove', path: args.path } })
  }

  async mkdir(args: { path: string }): Promise<void> {
    await invoke({ calls: this.args.calls, op: { op: 'mkdir', path: args.path } })
  }

  async rename(args: { from: string; to: string }): Promise<void> {
    await invoke({ calls: this.args.calls, op: { op: 'rename', from: args.from, to: args.to } })
  }

  async readDirectory(args: { path: string }): Promise<readonly FileSystemEntry[]> {
    const entries = await invoke({
      calls: this.args.calls,
      op: { op: 'readDirectory', path: args.path },
    })
    return entries.map(entryOf)
  }

  async glob(args: {
    pattern: string
    cwd: string
    dot?: boolean
    signal?: AbortSignal
  }): Promise<readonly string[]> {
    return await invoke({
      calls: this.args.calls,
      op: {
        op: 'glob',
        pattern: args.pattern,
        cwd: args.cwd,
        ...(args.dot === undefined ? {} : { dot: args.dot }),
      },
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }
}
