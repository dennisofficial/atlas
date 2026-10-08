import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { describeArchiveFile } from '../archive-file'
import { buildSessionArchive, extractSessionArchive, type SessionArchiveFile } from '../session-archive'
import { SessionWalkError, walkRegularFiles } from '../session-walker'

const dirs: string[] = []
const fresh = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-session-archive-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) rmSync(dir, { recursive: true, force: true })
})

const writeSession = (dir: string): void => {
  mkdirSync(join(dir, 'threads'), { recursive: true })
  writeFileSync(join(dir, 'meta.json'), '{"format":1,"id":"thr"}')
  writeFileSync(join(dir, 'ledger.jsonl'), '{"runId":"run_1"}\n')
  writeFileSync(join(dir, 'threads', 'thr.events.jsonl'), '{"v":1}\n')
  writeFileSync(join(dir, 'threads', 'thr.meta.json'), '{"id":"thr"}')
}

const build = async (sessionDir: string): Promise<SessionArchiveFile> => {
  const archive = await buildSessionArchive({ sessionDir })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

const caught = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('the session archive', () => {
  it('reports build progress walking, then staging, then compressing in order', async () => {
    const source = fresh()
    writeSession(source)
    const phases: string[] = []
    const archive = await buildSessionArchive({
      sessionDir: source,
      onBuildProgress: (p) => phases.push(p.phase),
    })
    expect(archive).not.toBe(undefined)
    expect(phases[0]).toBe('walking')
    expect(phases).toContain('staging')
    expect(phases[phases.length - 1]).toBe('compressing')
    expect(phases.indexOf('staging')).toBeGreaterThan(phases.indexOf('walking'))
    archive?.dispose()
  })

  it('round-trips the session directory through a tar.gz file', async () => {
    const source = fresh()
    writeSession(source)

    const archive = await build(source)
    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archivePath: archive.path, sessionDir: target })

    expect(readFileSync(join(target, 'meta.json'), 'utf8')).toBe('{"format":1,"id":"thr"}')
    expect(readFileSync(join(target, 'threads', 'thr.events.jsonl'), 'utf8')).toBe('{"v":1}\n')
    expect(readFileSync(join(target, 'threads', 'thr.meta.json'), 'utf8')).toBe('{"id":"thr"}')
    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
    await archive.dispose()
  })

  it('answers size and sha256 that match the file on disk, and dispose removes it', async () => {
    const source = fresh()
    writeSession(source)

    const archive = await build(source)
    const bytes = readFileSync(archive.path)

    expect(archive.size).toBe(bytes.length)
    expect(archive.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(await describeArchiveFile({ path: archive.path })).toEqual({ size: archive.size, sha256: archive.sha256 })

    await archive.dispose()
    expect(existsSync(archive.path)).toBe(false)
  })

  it('builds into the requested archivePath and disposes only that file', async () => {
    const source = fresh()
    writeSession(source)
    const exports = fresh()
    const archivePath = join(exports, 'nested', 'session.tar.gz')

    const archive = await buildSessionArchive({ sessionDir: source, archivePath })

    expect(archive?.path).toBe(archivePath)
    expect(readdirSync(join(exports, 'nested'))).toEqual(['session.tar.gz'])
    await archive?.dispose()
    expect(existsSync(archivePath)).toBe(false)
    expect(existsSync(exports)).toBe(true)
  })

  it('leaves no archive or partial behind when tar fails', async () => {
    const source = fresh()
    writeSession(source)
    const exports = fresh()

    await expect(
      buildSessionArchive({ sessionDir: source, archivePath: join(exports, 's.tar.gz'), tarCommand: 'false' }),
    ).rejects.toThrow('tar')

    expect(readdirSync(exports)).toEqual([])
  })

  it('leaves the session lock out of the archive', async () => {
    const source = fresh()
    writeSession(source)
    writeFileSync(join(source, 'lock'), '{"pid":1,"label":"atlas tui"}')

    const archive = await build(source)
    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archivePath: archive.path, sessionDir: target })

    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
  })

  it('overwrites whatever the target held — the archive is the whole truth', async () => {
    const source = fresh()
    writeSession(source)
    const archive = await build(source)

    const target = join(fresh(), 'restored')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'stale.json'), 'stale')

    await extractSessionArchive({ archivePath: archive.path, sessionDir: target })

    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
  })

  it('leaves the original transcript intact when extraction fails', async () => {
    const parent = fresh()
    const target = join(parent, 'session')
    writeSession(target)
    const before = readFileSync(join(target, 'threads', 'thr.events.jsonl'))
    const broken = join(fresh(), 'broken.tar.gz')
    writeFileSync(broken, 'broken archive')

    await expect(extractSessionArchive({ archivePath: broken, sessionDir: target })).rejects.toThrow()

    expect(readFileSync(join(target, 'threads', 'thr.events.jsonl'))).toEqual(before)
    expect(readdirSync(parent)).toEqual(['session'])
  })

  it('leaves the original transcript intact when the archive file is missing', async () => {
    const parent = fresh()
    const target = join(parent, 'session')
    writeSession(target)

    await expect(extractSessionArchive({ archivePath: join(fresh(), 'absent.tar.gz'), sessionDir: target })).rejects.toThrow()

    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
    expect(readdirSync(parent)).toEqual(['session'])
  })

  it('answers undefined for an empty directory rather than shipping an empty archive', async () => {
    expect(await buildSessionArchive({ sessionDir: fresh() })).toBeUndefined()
  })

  it('answers undefined only for a root that truly does not exist', async () => {
    expect(await buildSessionArchive({ sessionDir: join(fresh(), 'never-created') })).toBeUndefined()
  })

  it('preserves odd names, nested paths, empty files and modification times', async () => {
    const source = fresh()
    writeSession(source)
    const nested = join(source, 'threads', 'thr', 'notes dir', 'ünï')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'a b.txt'), 'spaced')
    writeFileSync(join(nested, '-dash.txt'), 'dash')
    writeFileSync(join(nested, 'empty'), '')
    const stamp = new Date('2024-01-02T03:04:05Z')
    utimesSync(join(nested, 'a b.txt'), stamp, stamp)

    const archive = await build(source)
    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archivePath: archive.path, sessionDir: target })

    const restored = join(target, 'threads', 'thr', 'notes dir', 'ünï')
    expect(readFileSync(join(restored, 'a b.txt'), 'utf8')).toBe('spaced')
    expect(readFileSync(join(restored, '-dash.txt'), 'utf8')).toBe('dash')
    expect(readFileSync(join(restored, 'empty'), 'utf8')).toBe('')
    expect(Math.floor(statSync(join(restored, 'a b.txt')).mtimeMs / 1000)).toBe(stamp.getTime() / 1000)
  })

  it('does not follow a directory symlink cycle and archives every real file once', async () => {
    const source = fresh()
    writeSession(source)
    mkdirSync(join(source, 'aws'), { recursive: true })
    writeFileSync(join(source, 'aws', 'creds.json'), 'real')
    symlinkSync('.', join(source, 'aws', 'current'))
    symlinkSync(source, join(source, 'loop'))

    const archive = await build(source)
    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archivePath: archive.path, sessionDir: target })

    expect(await walkRegularFiles({ root: target })).toEqual([
      'aws/creds.json',
      'ledger.jsonl',
      'meta.json',
      'threads/thr.events.jsonl',
      'threads/thr.meta.json',
    ])
  })

  it('keeps excluding file symlinks as the portable policy always did', async () => {
    const source = fresh()
    writeSession(source)
    symlinkSync(join(source, 'meta.json'), join(source, 'alias.json'))

    expect(await walkRegularFiles({ root: source })).not.toContain('alias.json')
  })

  it('reports a root that is not a directory with its actual path instead of claiming no transcript', async () => {
    const parent = fresh()
    const notADirectory = join(parent, 'session')
    writeFileSync(notADirectory, 'file')

    const error = await caught(buildSessionArchive({ sessionDir: notADirectory }))

    expect(error).toBeInstanceOf(SessionWalkError)
    expect(error instanceof SessionWalkError && error.path).toBe(notADirectory)
    expect(error instanceof SessionWalkError && error.code).toBe('ENOTDIR')
    expect((error as Error).message).toContain(notADirectory)
  })

  it('reports ELOOP for a root that is a symlink to itself with its path', async () => {
    const parent = fresh()
    const loop = join(parent, 'session')
    symlinkSync(loop, loop)

    const error = await caught(buildSessionArchive({ sessionDir: loop }))

    expect(error instanceof SessionWalkError && error.code).toBe('ELOOP')
    expect(error instanceof SessionWalkError && error.path).toBe(loop)
  })

  it('digests a large file by streaming it', async () => {
    const dir = fresh()
    const path = join(dir, 'big.bin')
    const chunk = Buffer.alloc(1024 * 1024, 7)
    const hash = createHash('sha256')
    const fd = openSync(path, 'w')
    for (let index = 0; index < 96; index += 1) {
      writeSync(fd, chunk)
      hash.update(chunk)
    }
    closeSync(fd)

    expect(await describeArchiveFile({ path })).toEqual({ size: 96 * 1024 * 1024, sha256: hash.digest('hex') })
  })

  it('reports an unreadable child directory with its path', async () => {
    if (process.getuid?.() === 0) return
    const source = fresh()
    writeSession(source)
    const locked = join(source, 'threads', 'locked')
    mkdirSync(locked)
    writeFileSync(join(locked, 'x'), 'x')
    Bun.spawnSync(['chmod', '000', locked])

    try {
      const error = await caught(buildSessionArchive({ sessionDir: source }))
      expect(error).toBeInstanceOf(SessionWalkError)
      expect(error instanceof SessionWalkError && error.path).toBe(locked)
      expect(error instanceof SessionWalkError && error.code).toBe('EACCES')
    } finally {
      Bun.spawnSync(['chmod', '755', locked])
    }
  })
})
