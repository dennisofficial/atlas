import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EShellPhase } from '../../shells/durable/protocol'
import { IMPORTED_SHELL_ORIGIN, IMPORTED_SHELL_ORIGIN_FILE, isPortableSessionFile } from '../portable-session-file'
import { buildSessionArchive, extractSessionArchive } from '../session-archive'

const dirs: string[] = []
const fresh = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-session-shells-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) rmSync(dir, { recursive: true, force: true })
})

const IDENTITY = 'identity-0123456789ab'
const SHELL = join('threads', 'thr', 'shells', 'shell_1')

const statusOf = (phase: EShellPhase): string =>
  JSON.stringify({
    version: 1,
    identity: IDENTITY,
    phase,
    startedAt: 1,
    updatedAt: 2,
    lastAttachedAt: 0,
    lastClaimedAt: 0,
    attachedClients: 0,
  })

const writeShell = (args: { session: string; phase: EShellPhase }): string => {
  const shell = join(args.session, SHELL)
  mkdirSync(join(shell, 'leases'), { recursive: true })
  writeFileSync(join(shell, 'spool.out'), 'built\n')
  writeFileSync(join(shell, 'status.json'), statusOf(args.phase))
  writeFileSync(join(shell, 'meta.json'), '{"child":{"pid":4242}}')
  writeFileSync(join(shell, 'config.json'), '{"command":"make"}')
  writeFileSync(join(shell, 'cursor'), '6')
  writeFileSync(join(shell, 'supervisor.log'), 'log')
  writeFileSync(join(shell, 'control.token'), 'secret')
  writeFileSync(join(shell, 'control.sock'), 'sock')
  writeFileSync(join(shell, 'lock'), 'lock')
  writeFileSync(join(shell, 'leases', 'client.lease'), '1')
  writeFileSync(join(shell, 'leases', 'notes.txt'), 'keep')
  return shell
}

const writeSession = (dir: string): void => {
  mkdirSync(join(dir, 'threads'), { recursive: true })
  writeFileSync(join(dir, 'meta.json'), '{"format":1,"id":"thr"}')
  writeFileSync(join(dir, 'threads', 'thr.events.jsonl'), '{"v":1}\n')
  writeFileSync(join(dir, 'lock'), '{"pid":1}')
}

const roundTrip = async (source: string): Promise<string> => {
  const archive = await buildSessionArchive({ sessionDir: source })
  if (archive === undefined) throw new Error('expected an archive')
  const target = join(fresh(), 'restored')
  await extractSessionArchive({ archivePath: archive.path, sessionDir: target })
  await archive.dispose()
  return target
}

describe('shell files in the session archive', () => {
  it('keeps the spool, status, meta, config and cursor and drops the machine-bound files', async () => {
    const source = fresh()
    writeSession(source)
    writeShell({ session: source, phase: EShellPhase.Exited })

    const target = await roundTrip(source)
    const shell = join(target, SHELL)

    expect(readFileSync(join(shell, 'spool.out'), 'utf8')).toBe('built\n')
    for (const kept of ['status.json', 'meta.json', 'config.json', 'cursor', 'supervisor.log']) {
      expect(existsSync(join(shell, kept))).toBe(true)
    }
    for (const dropped of ['control.token', 'control.sock', 'lock', join('leases', 'client.lease')]) {
      expect(existsSync(join(shell, dropped))).toBe(false)
    }
    expect(existsSync(join(shell, 'leases', 'notes.txt'))).toBe(true)
    expect(existsSync(join(target, 'lock'))).toBe(false)
  })

  it('marks each restored shell directory as imported', async () => {
    const source = fresh()
    writeSession(source)
    writeShell({ session: source, phase: EShellPhase.Exited })

    const target = await roundTrip(source)

    expect(readFileSync(join(target, SHELL, IMPORTED_SHELL_ORIGIN_FILE), 'utf8')).toBe(IMPORTED_SHELL_ORIGIN)
    expect(existsSync(join(target, 'threads', 'thr.events.jsonl'))).toBe(true)
  })

  it('strips machine-bound shell files an older archive still carries on restore', async () => {
    const source = fresh()
    writeSession(source)
    const shell = writeShell({ session: source, phase: EShellPhase.Exited })
    const archive = await buildSessionArchive({ sessionDir: source })
    expect(archive).toBeDefined()
    await archive?.dispose()
    const forged = fresh()
    mkdirSync(join(forged, SHELL), { recursive: true })
    writeFileSync(join(forged, 'meta.json'), '{}')
    writeFileSync(join(forged, SHELL, 'status.json'), readFileSync(join(shell, 'status.json')))
    writeFileSync(join(forged, SHELL, 'control.token'), 'secret')
    const forgedArchive = join(fresh(), 'forged.tar.gz')
    Bun.spawnSync(['tar', '-czf', forgedArchive, '-C', forged, '.'])
    const target = join(fresh(), 'restored')

    await extractSessionArchive({ archivePath: forgedArchive, sessionDir: target })

    expect(existsSync(join(target, SHELL, 'control.token'))).toBe(false)
    expect(existsSync(join(target, SHELL, 'status.json'))).toBe(true)
  })

  it('leaves arbitrary files named like shell files untouched outside a shell directory', async () => {
    const source = fresh()
    writeSession(source)
    mkdirSync(join(source, 'tmp', 'shells', 'shell_1'), { recursive: true })
    mkdirSync(join(source, 'threads', 'thr', 'shells'), { recursive: true })
    writeFileSync(join(source, 'tmp', 'shells', 'shell_1', 'lock'), 'user')
    writeFileSync(join(source, 'threads', 'thr', 'lock'), 'thread lock')
    writeFileSync(join(source, 'threads', 'thr', 'shells', 'control.sock'), 'loose')
    writeFileSync(join(source, 'threads', 'thr', 'control.token'), 'agent temp')

    const target = await roundTrip(source)

    expect(readFileSync(join(target, 'tmp', 'shells', 'shell_1', 'lock'), 'utf8')).toBe('user')
    expect(readFileSync(join(target, 'threads', 'thr', 'lock'), 'utf8')).toBe('thread lock')
    expect(readFileSync(join(target, 'threads', 'thr', 'shells', 'control.sock'), 'utf8')).toBe('loose')
    expect(readFileSync(join(target, 'threads', 'thr', 'control.token'), 'utf8')).toBe('agent temp')
    expect(existsSync(join(target, 'tmp', 'shells', 'shell_1', IMPORTED_SHELL_ORIGIN_FILE))).toBe(false)
  })

  it('refuses to build while a shell has no terminal status', async () => {
    const source = fresh()
    writeSession(source)
    writeShell({ session: source, phase: EShellPhase.Running })

    await expect(buildSessionArchive({ sessionDir: source })).rejects.toThrow('no terminal status')
  })

  it('refuses a shell directory with no status file at all', async () => {
    const source = fresh()
    writeSession(source)
    mkdirSync(join(source, SHELL), { recursive: true })
    writeFileSync(join(source, SHELL, 'spool.out'), 'partial')

    await expect(buildSessionArchive({ sessionDir: source })).rejects.toThrow(SHELL)
  })

  it('accepts a start-failed shell as terminal', async () => {
    const source = fresh()
    writeSession(source)
    writeShell({ session: source, phase: EShellPhase.StartFailed })

    const archive = await buildSessionArchive({ sessionDir: source })
    expect(archive).toBeDefined()
    await archive?.dispose()
  })
})

describe('the portable session file filter', () => {
  it('judges keys by their place under threads/<id>/shells/<id>/ only', () => {
    expect(isPortableSessionFile({ key: 'lock' })).toBe(false)
    expect(isPortableSessionFile({ key: `${SHELL}/control.sock`.replaceAll('\\', '/') })).toBe(false)
    expect(isPortableSessionFile({ key: 'threads/thr/shells/shell_1/leases/a.lease' })).toBe(false)
    expect(isPortableSessionFile({ key: 'threads/thr/shells/shell_1/spool.out' })).toBe(true)
    expect(isPortableSessionFile({ key: 'threads/thr/shells/lock' })).toBe(true)
    expect(isPortableSessionFile({ key: 'other/thr/shells/shell_1/lock' })).toBe(true)
    expect(isPortableSessionFile({ key: 'threads/thr/notes/shell_1/lock' })).toBe(true)
  })
})
