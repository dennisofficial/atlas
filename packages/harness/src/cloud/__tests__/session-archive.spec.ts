import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { buildSessionArchive, extractSessionArchive } from '../session-archive'

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

describe('the session archive', () => {
  it('round-trips the session directory through a tar.gz', async () => {
    const source = fresh()
    writeSession(source)

    const archive = await buildSessionArchive({ sessionDir: source })
    if (archive === undefined) throw new Error('expected an archive')

    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archive, sessionDir: target })

    expect(readFileSync(join(target, 'meta.json'), 'utf8')).toBe('{"format":1,"id":"thr"}')
    expect(readFileSync(join(target, 'threads', 'thr.events.jsonl'), 'utf8')).toBe('{"v":1}\n')
    expect(readFileSync(join(target, 'threads', 'thr.meta.json'), 'utf8')).toBe('{"id":"thr"}')
    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
  })

  it('leaves the session lock out of the archive', async () => {
    const source = fresh()
    writeSession(source)
    writeFileSync(join(source, 'lock'), '{"pid":1,"label":"atlas tui"}')

    const archive = await buildSessionArchive({ sessionDir: source })
    if (archive === undefined) throw new Error('expected an archive')

    const target = join(fresh(), 'restored')
    await extractSessionArchive({ archive, sessionDir: target })

    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
  })

  it('overwrites whatever the target held — the archive is the whole truth', async () => {
    const source = fresh()
    writeSession(source)
    const archive = await buildSessionArchive({ sessionDir: source })
    if (archive === undefined) throw new Error('expected an archive')

    const target = join(fresh(), 'restored')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'stale.json'), 'stale')

    await extractSessionArchive({ archive, sessionDir: target })

    expect(readdirSync(target).sort()).toEqual(['ledger.jsonl', 'meta.json', 'threads'])
  })

  it('answers undefined for an empty directory rather than shipping an empty archive', async () => {
    const source = fresh()

    expect(await buildSessionArchive({ sessionDir: source })).toBeUndefined()
  })
})
