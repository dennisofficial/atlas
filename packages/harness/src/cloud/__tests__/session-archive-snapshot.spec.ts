import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { buildSessionArchive, extractSessionArchive } from '../session-archive'
import { SessionWalkError } from '../session-walker'

const dirs: string[] = []
const fresh = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-session-snapshot-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) rmSync(dir, { recursive: true, force: true })
})

const writeSession = (dir: string): void => {
  mkdirSync(join(dir, 'threads'), { recursive: true })
  writeFileSync(join(dir, 'meta.json'), '{"format":1,"id":"thr"}')
  writeFileSync(join(dir, 'threads', 'thr.events.jsonl'), '{"v":1}\n')
}

const caught = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('the session archive snapshot', () => {
  it('archives a private snapshot so writes to the live session during tar never reach it', async () => {
    const source = fresh()
    writeSession(source)
    writeFileSync(join(source, 'logs.jsonl'), 'before\n')
    const tools = fresh()
    const seen = join(tools, 'seen')
    const script = join(tools, 'tar-while-writing')
    writeFileSync(
      script,
      [
        '#!/bin/sh',
        'prev=""',
        'for arg in "$@"; do',
        `  [ "$prev" = "-C" ] && printf '%s' "$arg" > ${JSON.stringify(seen)}`,
        '  prev="$arg"',
        'done',
        `printf 'during\\n' >> ${JSON.stringify(join(source, 'logs.jsonl'))}`,
        `printf 'during\\n' >> ${JSON.stringify(join(source, 'threads', 'thr.events.jsonl'))}`,
        'exec tar "$@"',
        '',
      ].join('\n'),
    )
    chmodSync(script, 0o755)

    const archive = await buildSessionArchive({ sessionDir: source, tarCommand: script })
    if (archive === undefined) throw new Error('expected an archive')
    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archivePath: archive.path, sessionDir: target })

    const privateRoot = readFileSync(seen, 'utf8')
    expect(privateRoot).not.toBe(source)
    expect(privateRoot.startsWith(source)).toBe(false)
    expect(readFileSync(join(source, 'logs.jsonl'), 'utf8')).toBe('before\nduring\n')
    expect(readFileSync(join(target, 'logs.jsonl'), 'utf8')).toBe('before\n')
    expect(readFileSync(join(target, 'threads', 'thr.events.jsonl'), 'utf8')).toBe('{"v":1}\n')
    await archive.dispose()
  })

  it('reports a file that cannot be staged with its actual path and leaves nothing behind', async () => {
    if (process.getuid?.() === 0) return
    const source = fresh()
    writeSession(source)
    const exports = fresh()
    const unreadable = join(source, 'threads', 'thr.events.jsonl')
    chmodSync(unreadable, 0o000)

    try {
      const error = await caught(buildSessionArchive({ sessionDir: source, archivePath: join(exports, 's.tar.gz') }))
      expect(error).toBeInstanceOf(SessionWalkError)
      expect(error instanceof SessionWalkError && error.path).toBe(unreadable)
      expect(error instanceof SessionWalkError && error.code).toBe('EACCES')
      expect(readdirSync(exports)).toEqual([])
    } finally {
      chmodSync(unreadable, 0o644)
    }
  })
})
