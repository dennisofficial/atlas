import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { DockerFileSystemPort, RemoteFileError } from '../docker-filesystem'
import { FakeProcesses, type CannedExec } from './fake-processes'

const THREAD = toThreadId('docker-thread')

const port = (answer: (cmd: readonly string[]) => CannedExec): DockerFileSystemPort =>
  new DockerFileSystemPort({ processes: new FakeProcesses(answer) })

const ok = (stdout = ''): CannedExec => ({ stdout })

describe('DockerFileSystemPort stat', () => {
  it('parses size, hex mode and epoch seconds into a FileStat', async () => {
    const files = port(() => ok('123 81a4 1757900000\n'))

    const stats = await files.stat({ path: '/work/a.ts', threadId: THREAD })

    expect(stats.size).toBe(123)
    expect(stats.mode).toBe(0o100644)
    expect(stats.mtimeMs).toBe(1_757_900_000_000)
    expect(stats.isFile()).toBe(true)
    expect(stats.isDirectory()).toBe(false)
  })

  it('rejects with an ENOENT-coded error when the file is missing', async () => {
    const files = port(() => ({
      exitCode: 1,
      stderr: "stat: cannot statx '/work/missing': No such file or directory",
    }))

    const failure = await files.stat({ path: '/work/missing', threadId: THREAD }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(RemoteFileError)
    expect((failure as RemoteFileError).code).toBe('ENOENT')
  })
})

describe('DockerFileSystemPort read', () => {
  it('decodes base64 stdout back to the exact bytes', async () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 10, 0, 60])
    const encoded = `${Buffer.from(original).toString('base64')}\n`
    const files = port(() => ok(encoded))

    const bytes = await files.readBytes({ path: '/work/blob', threadId: THREAD })

    expect(bytes).toEqual(original)
  })

  it('reads utf8 text with multibyte characters intact', async () => {
    const content = 'héllo ✓ — 你好\nsecond line\n'
    const files = port(() => ok(Buffer.from(content, 'utf8').toString('base64')))

    expect(await files.readFile({ path: '/work/t.txt', threadId: THREAD })).toBe(content)
  })

  it('surfaces a missing file as ENOENT', async () => {
    const files = port(() => ({
      exitCode: 1,
      stderr: "base64: /work/gone: No such file or directory",
    }))

    const failure = await files.readBytes({ path: '/work/gone' }).catch((error: unknown) => error)

    expect((failure as RemoteFileError).code).toBe('ENOENT')
  })

  it('returns null from readLink when the path is not a symlink', async () => {
    const files = port(() => ({ exitCode: 1, stderr: "readlink: /work/f: Invalid argument" }))

    expect(await files.readLink({ path: '/work/f' })).toBeNull()
  })

  it('returns the leaf target from readLink for a symlink', async () => {
    const files = port(() => ok('../real/target.ts\n'))

    expect(await files.readLink({ path: '/work/link' })).toBe('../real/target.ts')
  })
})

describe('DockerFileSystemPort writeFile', () => {
  const scriptOf = (spawned: { cmd: readonly string[] }[], index: number): string =>
    String(spawned[index]?.cmd[2])

  it('writes empty content as a single truncating exec', async () => {
    const processes = new FakeProcesses(() => ok())
    const files = new DockerFileSystemPort({ processes })

    await files.writeFile({ path: '/work/empty.txt', content: '', threadId: THREAD })

    expect(processes.spawned).toHaveLength(1)
    expect(scriptOf(processes.spawned, 0)).toContain('> "$2"')
    expect(processes.spawned[0]?.threadId).toBe(THREAD)
  })

  it('chunks content at the exec-argument ceiling and appends after the first chunk', async () => {
    const processes = new FakeProcesses(() => ok())
    const files = new DockerFileSystemPort({ processes })
    const content = 'x'.repeat(64 * 1024) + ' tail ✓'

    await files.writeFile({ path: '/work/big.txt', content, threadId: THREAD })

    const writes = processes.spawned.filter((spawn) => String(spawn.cmd[2]).includes('base64 -d'))
    expect(writes).toHaveLength(2)
    expect(String(writes[0]?.cmd[2])).toContain('| base64 -d > "$2"')
    expect(String(writes[1]?.cmd[2])).toContain('| base64 -d >> "$2"')

    const decoded = Buffer.concat(
      writes.map((spawn) => Buffer.from(String(spawn.cmd[4]), 'base64')),
    )
    expect(decoded.equals(Buffer.from(content, 'utf8'))).toBe(true)
  })

  it('does not split content that fits one chunk', async () => {
    const processes = new FakeProcesses(() => ok())
    const files = new DockerFileSystemPort({ processes })

    await files.writeFile({ path: '/work/small.txt', content: 'x'.repeat(64 * 1024) })

    const writes = processes.spawned.filter((spawn) => String(spawn.cmd[2]).includes('base64 -d'))
    expect(writes).toHaveLength(1)
    expect(String(writes[0]?.cmd[2])).toContain('> "$2"')
  })

  it('applies the mode with a chmod after the write', async () => {
    const processes = new FakeProcesses(() => ok())
    const files = new DockerFileSystemPort({ processes })

    await files.writeFile({ path: '/work/tool.sh', content: '#!/bin/sh\n', mode: 0o755 })

    const chmod = processes.spawned.find((spawn) => String(spawn.cmd[2]).startsWith('chmod'))
    expect(chmod?.cmd[4]).toBe('755')
  })
})

describe('DockerFileSystemPort directory operations', () => {
  it('maps find records to directory entries with Dirent-like shape', async () => {
    const files = port(() => ok('f\talpha.ts\0d\tsrc\0l\tlink\0'))

    const entries = await files.readDirectory({ path: '/work', threadId: THREAD })

    expect(entries.map((entry) => entry.name)).toEqual(['alpha.ts', 'src', 'link'])
    expect(entries[0]?.isFile()).toBe(true)
    expect(entries[1]?.isDirectory()).toBe(true)
    expect(entries[2]?.isFile()).toBe(false)
    expect(entries[2]?.isDirectory()).toBe(false)
  })

  it('rejects readDirectory with ENOENT for a missing directory', async () => {
    const files = port(() => ({
      exitCode: 1,
      stderr: "find: '/work/nope': No such file or directory",
    }))

    const failure = await files.readDirectory({ path: '/work/nope' }).catch((e: unknown) => e)

    expect((failure as RemoteFileError).code).toBe('ENOENT')
  })

  it('rejects removeFile for a missing path, matching unlink', async () => {
    const files = port(() => ({
      exitCode: 1,
      stderr: "rm: cannot remove '/work/gone': No such file or directory",
    }))

    const failure = await files.removeFile({ path: '/work/gone' }).catch((e: unknown) => e)

    expect((failure as RemoteFileError).code).toBe('ENOENT')
  })

  it('creates parents on mkdir and refuses directory targets on rename', async () => {
    const processes = new FakeProcesses(() => ok())
    const files = new DockerFileSystemPort({ processes })

    await files.mkdir({ path: '/work/a/b', threadId: THREAD })
    await files.rename({ from: '/work/a', to: '/work/b', threadId: THREAD })

    expect(String(processes.spawned[0]?.cmd[2])).toContain('mkdir -p')
    expect(String(processes.spawned[1]?.cmd[2])).toContain('mv -T')
  })
})
