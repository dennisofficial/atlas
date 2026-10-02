import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  downloadWorkspaceArchive,
  exportedWorkspacePathOf,
  releaseWorkspaceExport,
  uploadWorkspaceArchive,
  WORKSPACE_EXPORT_DIRECTORY,
  type ArchiveUploadSandbox,
} from '../workspace-archive-transport'

const roots: string[] = []

const scratch = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-archive-transport-'))
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

const localSandbox = (observed: { writes: number[]; commands: number[] }, failAt?: number) => {
  let writeCount = 0
  const sandbox: ArchiveUploadSandbox = {
    writeFiles: async (files) => {
      for (const file of files) {
        writeCount += 1
        if (failAt !== undefined && writeCount === failAt) throw new Error('the write failed')
        observed.writes.push(file.content.byteLength)
        await mkdir(dirname(file.path), { recursive: true })
        await writeFile(file.path, file.content)
      }
    },
    runCommand: async ({ args }) => {
      const script = args[1] ?? ''
      observed.commands.push(script.length)
      return { exitCode: await runShell(script) }
    },
  }
  return sandbox
}

describe('uploading a workspace archive', () => {
  it('streams bounded chunks and reassembles the exact bytes', async () => {
    const root = await scratch()
    const source = join(root, 'source.tar.gz')
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 251))
    await writeFile(source, bytes)
    const observed = { writes: [] as number[], commands: [] as number[] }
    const destination = join(root, 'drive', 'bootstrap', 'workspace.tar.gz')

    await uploadWorkspaceArchive({
      sandbox: localSandbox(observed),
      source,
      destination,
      chunkBytes: 64,
      batchParts: 4,
    })

    expect(Math.max(...observed.writes)).toBeLessThanOrEqual(64)
    expect(observed.writes.length).toBe(Math.ceil(1000 / 64))
    expect(Math.max(...observed.commands)).toBeLessThan(2000)
    expect(Buffer.compare(await readFile(destination), bytes)).toBe(0)
    expect(await readdir(dirname(destination))).toEqual(['workspace.tar.gz'])
  })

  it('never publishes a partial archive when a chunk fails', async () => {
    const root = await scratch()
    const source = join(root, 'source.tar.gz')
    await writeFile(source, Buffer.alloc(500, 7))
    const destination = join(root, 'drive', 'workspace.tar.gz')

    await expect(
      uploadWorkspaceArchive({
        sandbox: localSandbox({ writes: [], commands: [] }, 5),
        source,
        destination,
        chunkBytes: 64,
        batchParts: 2,
      }),
    ).rejects.toThrow('the write failed')

    expect(await readdir(join(root, 'drive'))).toEqual([])
  })
})

describe('downloading a workspace archive', () => {
  const exportPath = `${WORKSPACE_EXPORT_DIRECTORY}/workspace-abc123.tar.gz`

  it('pipes the remote stream into the destination atomically', async () => {
    const root = await scratch()
    const destination = join(root, 'nested', 'workspace.tar.gz')
    const requested: string[] = []

    await downloadWorkspaceArchive({
      sandbox: {
        readFile: async ({ path }) => {
          requested.push(path)
          return Readable.from([Buffer.from('tar-'), Buffer.from('bytes')])
        },
      },
      path: exportPath,
      destination,
    })

    expect(requested).toEqual([exportPath])
    expect(await readFile(destination, 'utf8')).toBe('tar-bytes')
    expect(await readdir(dirname(destination))).toEqual(['workspace.tar.gz'])
  })

  it('leaves no destination behind when the stream fails midway', async () => {
    const root = await scratch()
    const destination = join(root, 'workspace.tar.gz')
    const failing = new Readable({
      read() {
        this.push(Buffer.from('half'))
        this.destroy(new Error('the connection dropped'))
      },
    })

    await expect(
      downloadWorkspaceArchive({
        sandbox: { readFile: async () => failing },
        path: exportPath,
        destination,
      }),
    ).rejects.toThrow('the connection dropped')

    expect(await readdir(root)).toEqual([])
  })

  it('refuses any path outside the dedicated export directory', () => {
    for (const path of [
      '/etc/passwd',
      `${WORKSPACE_EXPORT_DIRECTORY}/../auth.json`,
      `${WORKSPACE_EXPORT_DIRECTORY}/workspace-x.tar.gz/../../auth.json`,
      `${WORKSPACE_EXPORT_DIRECTORY}/nested/workspace-x.tar.gz`,
      `${WORKSPACE_EXPORT_DIRECTORY}/auth.json`,
      `${WORKSPACE_EXPORT_DIRECTORY}/workspace-x.tar`,
    ]) {
      expect(() => exportedWorkspacePathOf(path)).toThrow('not a workspace export')
    }
    expect(exportedWorkspacePathOf(exportPath)).toBe(exportPath)
  })

  it('releases only a validated export path', async () => {
    const commands: string[] = []
    const sandbox: ArchiveUploadSandbox = {
      writeFiles: async () => undefined,
      runCommand: async ({ args }) => {
        commands.push(args[1] ?? '')
        return { exitCode: 0 }
      },
    }

    await releaseWorkspaceExport({ sandbox, path: exportPath })
    await expect(releaseWorkspaceExport({ sandbox, path: '/atlas/home/auth.json' })).rejects.toThrow()

    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain(exportPath)
  })
})
