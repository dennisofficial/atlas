import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it } from 'bun:test'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'
import { toThreadId } from '@dltech/atlas-core'

import { downloadSessionArchive, exportedSessionPathOf, releaseSessionExport, SESSION_EXPORT_DIRECTORY } from '../session-archive-transport'

const threadId = toThreadId('brn_stream-root')
const path = `${SESSION_EXPORT_DIRECTORY}/session-${threadId}-abcdef012345.tar.gz`
const roots: string[] = []
const scratch = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-session-download-'))
  roots.push(root)
  return root
}
const descriptor = (bytes: Buffer): SessionArchiveDescriptor => ({
  path, threadId, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'),
})

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('session archive file transport', () => {
  it('streams a verified archive and atomically publishes its exact bytes', async () => {
    const root = await scratch()
    const destination = join(root, 'session.tar.gz')
    const bytes = Buffer.from('session bytes')
    const reads: string[] = []
    await downloadSessionArchive({
      sandbox: { readFile: async (file) => {
        reads.push(file.path)
        return Readable.from([bytes.subarray(0, 3), bytes.subarray(3)])
      } },
      threadId, archive: descriptor(bytes), destination,
    })
    expect(reads).toEqual([path])
    expect(await readFile(destination)).toEqual(bytes)
    expect(await readdir(root)).toEqual(['session.tar.gz'])
  })

  it('rejects checksum, short, and oversized streams without replacing existing files', async () => {
    const root = await scratch()
    const destination = join(root, 'session.tar.gz')
    const bytes = Buffer.from('correct')
    await writeFile(destination, 'existing')
    for (const streamBytes of [Buffer.from('altered'), bytes.subarray(0, 2), Buffer.concat([bytes, bytes])]) {
      await expect(downloadSessionArchive({
        sandbox: { readFile: async () => Readable.from([streamBytes]) },
        threadId, archive: descriptor(bytes), destination,
      })).rejects.toThrow(/declared size|checksum/)
      expect(await readFile(destination, 'utf8')).toBe('existing')
      expect(await readdir(root)).toEqual(['session.tar.gz'])
    }
  })

  it('preserves the destination and removes partial files when the stream is interrupted', async () => {
    const root = await scratch()
    const destination = join(root, 'session.tar.gz')
    await writeFile(destination, 'existing')
    const stream = Readable.from((async function* () {
      yield Buffer.from('partial')
      throw new Error('connection interrupted')
    })())
    await expect(downloadSessionArchive({
      sandbox: { readFile: async () => stream },
      threadId, archive: descriptor(Buffer.from('partial and more')), destination,
    })).rejects.toThrow('connection interrupted')
    expect(await readFile(destination, 'utf8')).toBe('existing')
    expect(await readdir(root)).toEqual(['session.tar.gz'])
  })

  it('refuses absent exports', async () => {
    const root = await scratch()
    await expect(downloadSessionArchive({
      sandbox: { readFile: async () => null },
      threadId, archive: descriptor(Buffer.alloc(0)), destination: join(root, 'session.tar.gz'),
    })).rejects.toThrow('no session export')
    expect(await readdir(root)).toEqual([])
  })

  it('requires the root and an exact owned export path before asking the SDK for bytes', async () => {
    const root = await scratch()
    let reads = 0
    for (const archive of [
      { ...descriptor(Buffer.alloc(0)), threadId: toThreadId('other') },
      { ...descriptor(Buffer.alloc(0)), path: '/atlas/home/auth.json' },
      { ...descriptor(Buffer.alloc(0)), path: path.replace(threadId, 'brn_other') },
      { ...descriptor(Buffer.alloc(0)), path: path.replace('/exports/', '/exports/../exports/') },
      { ...descriptor(Buffer.alloc(0)), path: path.replace('abcdef012345', 'unowned') },
    ]) {
      await expect(downloadSessionArchive({
        sandbox: { readFile: async () => { reads += 1; return null } },
        threadId, archive, destination: join(root, 'session.tar.gz'),
      })).rejects.toThrow()
    }
    expect(reads).toBe(0)
    expect(exportedSessionPathOf({ path, threadId })).toBe(path)
  })

  it('releases only an exact root-owned export generation', async () => {
    const commands: string[][] = []
    const sandbox = {
      writeFiles: async () => undefined,
      runCommand: async (given: { cmd: string; args: string[] }) => { commands.push([given.cmd, ...given.args]); return { exitCode: 0 } },
    }
    await releaseSessionExport({ sandbox, threadId, path })
    await expect(releaseSessionExport({ sandbox, threadId: toThreadId('other'), path })).rejects.toThrow()
    expect(commands).toEqual([['rm', '-f', '--', path]])
  })
})
