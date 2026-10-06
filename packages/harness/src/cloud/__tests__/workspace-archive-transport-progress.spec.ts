import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it } from 'bun:test'

import type { TransferProgress } from '../transfer-progress'
import {
  downloadWorkspaceArchive,
  uploadWorkspaceArchive,
  WORKSPACE_EXPORT_DIRECTORY,
  type ArchiveUploadSandbox,
} from '../workspace-archive-transport'

const roots: string[] = []

const scratch = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-archive-progress-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const runShell = (script: string): Promise<number> =>
  new Promise((resolve) => {
    spawn('sh', ['-c', script]).on('close', (code) => resolve(code ?? 1))
  })

const localSandbox = (args: { failWriteAt?: number; failCommandContaining?: string } = {}) => {
  let writeCount = 0
  const sandbox: ArchiveUploadSandbox = {
    writeFiles: async (files) => {
      for (const file of files) {
        writeCount += 1
        if (writeCount === args.failWriteAt) throw new Error('the write failed')
        await mkdir(dirname(file.path), { recursive: true })
        await writeFile(file.path, file.content)
      }
    },
    runCommand: async ({ args: commandArgs }) => {
      const script = commandArgs[1] ?? ''
      if (args.failCommandContaining !== undefined && script.includes(args.failCommandContaining)) {
        return { exitCode: 1 }
      }
      return { exitCode: await runShell(script) }
    },
  }
  return sandbox
}

const uploadWith = async (args: {
  size: number
  sandbox?: ArchiveUploadSandbox
}): Promise<{ events: TransferProgress[]; error: unknown; drive: string }> => {
  const root = await scratch()
  const source = join(root, 'source.tar.gz')
  await writeFile(source, Buffer.alloc(args.size, 3))
  const drive = join(root, 'drive')
  const events: TransferProgress[] = []
  let error: unknown
  try {
    await uploadWorkspaceArchive({
      sandbox: args.sandbox ?? localSandbox(),
      source,
      destination: join(drive, 'workspace.tar.gz'),
      chunkBytes: 64,
      batchParts: 2,
      concurrency: 1,
      onProgress: (progress) => events.push(progress),
    })
  } catch (failure) {
    error = failure
  }
  return { events, error, drive }
}

describe('upload progress', () => {
  it('reports zero, each acknowledged chunk cumulatively, then completion with the compressed size', async () => {
    const { events, error, drive } = await uploadWith({ size: 150 })

    expect(error).toBeUndefined()
    expect(events).toEqual([
      { transferredBytes: 0, totalBytes: 150, complete: false },
      { transferredBytes: 64, totalBytes: 150, complete: false },
      { transferredBytes: 128, totalBytes: 150, complete: false },
      { transferredBytes: 150, totalBytes: 150, complete: false },
      { transferredBytes: 150, totalBytes: 150, complete: true },
    ])
    expect(await readdir(drive)).toEqual(['workspace.tar.gz'])
  })

  it('does not count a chunk whose write failed and never completes', async () => {
    const { events, error } = await uploadWith({ size: 500, sandbox: localSandbox({ failWriteAt: 3 }) })

    expect(error).toBeInstanceOf(Error)
    expect(events.map((event) => event.transferredBytes)).toEqual([0, 64, 128])
    expect(events.some((event) => event.complete)).toBe(false)
  })

  it('does not complete when integrity verification fails', async () => {
    const { events, error, drive } = await uploadWith({
      size: 100,
      sandbox: localSandbox({ failCommandContaining: 'sha256sum' }),
    })

    expect(error).toBeInstanceOf(Error)
    expect(events.at(-1)).toEqual({ transferredBytes: 100, totalBytes: 100, complete: false })
    expect(await readdir(drive)).toEqual([])
  })

  it('transfers an empty archive and still completes', async () => {
    const { events, error } = await uploadWith({ size: 0 })

    expect(error).toBeUndefined()
    expect(events).toEqual([
      { transferredBytes: 0, totalBytes: 0, complete: false },
      { transferredBytes: 0, totalBytes: 0, complete: true },
    ])
  })
})

const exportPath = `${WORKSPACE_EXPORT_DIRECTORY}/workspace-abc123.tar.gz`

const downloadWith = async (args: {
  chunks: Buffer[]
  totalBytes?: number | undefined
  stream?: Readable
}): Promise<{ events: TransferProgress[]; error: unknown; root: string; destination: string }> => {
  const root = await scratch()
  const destination = join(root, 'workspace.tar.gz')
  const events: TransferProgress[] = []
  let error: unknown
  try {
    await downloadWorkspaceArchive({
      sandbox: { readFile: async () => args.stream ?? Readable.from(args.chunks) },
      path: exportPath,
      destination,
      totalBytes: args.totalBytes,
      onProgress: (progress) => events.push(progress),
    })
  } catch (failure) {
    error = failure
  }
  return { events, error, root, destination }
}

describe('download progress', () => {
  it('counts streamed bytes against a known total and completes after publication', async () => {
    const { events, error, destination } = await downloadWith({
      chunks: [Buffer.from('tar-'), Buffer.from('bytes')],
      totalBytes: 9,
    })

    expect(error).toBeUndefined()
    expect(events).toEqual([
      { transferredBytes: 0, totalBytes: 9, complete: false },
      { transferredBytes: 4, totalBytes: 9, complete: false },
      { transferredBytes: 9, totalBytes: 9, complete: false },
      { transferredBytes: 9, totalBytes: 9, complete: true },
    ])
    expect((await stat(destination)).size).toBe(9)
  })

  it('leaves the total absent when the server did not state one', async () => {
    const { events, error } = await downloadWith({ chunks: [Buffer.from('abc')] })

    expect(error).toBeUndefined()
    expect(events.every((event) => event.totalBytes === undefined)).toBe(true)
    expect(events.at(-1)).toMatchObject({ transferredBytes: 3, complete: true })
  })

  it('refuses to publish a truncated download', async () => {
    const { events, error, root } = await downloadWith({
      chunks: [Buffer.from('abc')],
      totalBytes: 10,
    })

    expect(String(error)).toContain('3 of 10 bytes')
    expect(events.some((event) => event.complete)).toBe(false)
    expect(await readdir(root)).toEqual([])
  })

  it('refuses to publish a download longer than its stated total', async () => {
    const { error, root } = await downloadWith({ chunks: [Buffer.from('abcdef')], totalBytes: 2 })

    expect(error).toBeInstanceOf(Error)
    expect(await readdir(root)).toEqual([])
  })

  it('completes a zero-byte download', async () => {
    const { events, error, destination } = await downloadWith({ chunks: [], totalBytes: 0 })

    expect(error).toBeUndefined()
    expect(events).toEqual([
      { transferredBytes: 0, totalBytes: 0, complete: false },
      { transferredBytes: 0, totalBytes: 0, complete: true },
    ])
    expect((await stat(destination)).size).toBe(0)
  })

  it('never completes when the stream fails midway', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from('half'))
        this.destroy(new Error('the connection dropped'))
      },
    })
    const { events, error, root } = await downloadWith({ chunks: [], stream: failing })

    expect(String(error)).toContain('the connection dropped')
    expect(events.some((event) => event.complete)).toBe(false)
    expect(await readdir(root)).toEqual([])
  })
})
