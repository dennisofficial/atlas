import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { journalResume } from '../resume-journal'

const clock = { now: () => '2026-09-15T15:02:11.000Z' }

let directory: string
let file: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-resume-journal-'))
  file = join(directory, 'resume-journal.log')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const started = { threadId: 'brn_1', title: 'Eve software factory architecture', started: true }

describe('journalResume', () => {
  it('appends the resume command with the thread handle, directory and pid', () => {
    journalResume({ active: started, command: 'atlas-dev', directory: '/dev/atlas', clock, file })

    const lines = readFileSync(file, 'utf8').split('\n')
    expect(lines[0]).toBe(
      `2026-09-15T15:02:11.000Z  /dev/atlas  (pid ${process.pid})  atlas-dev --resume "eve-software-factory-architecture"`,
    )
  })

  it('falls back to the thread id while the thread is untitled', () => {
    journalResume({
      active: { threadId: 'brn_9', title: null, started: true },
      command: 'atlas',
      directory: '/dev/atlas',
      clock,
      file,
    })

    expect(readFileSync(file, 'utf8')).toContain('atlas --resume "brn_9"')
  })

  it('writes nothing for a thread nobody has spoken in yet', () => {
    journalResume({
      active: { threadId: 'brn_1', title: null, started: false },
      command: 'atlas-dev',
      directory: '/dev/atlas',
      clock,
      file,
    })
    journalResume({ active: null, command: 'atlas-dev', directory: '/dev/atlas', clock, file })

    expect(existsSync(file)).toBe(false)
  })

  it('accumulates one line per switch or rename', () => {
    journalResume({ active: started, command: 'atlas-dev', directory: '/dev/atlas', clock, file })
    journalResume({
      active: { threadId: 'brn_2', title: 'Cloud gate fix', started: true },
      command: 'atlas-dev',
      directory: '/dev/atlas',
      clock,
      file,
    })
    journalResume({
      active: { threadId: 'brn_2', title: 'Cloud gate fix, take two', started: true },
      command: 'atlas-dev',
      directory: '/dev/atlas',
      clock,
      file,
    })

    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('"cloud-gate-fix"')
    expect(lines[2]).toContain('"cloud-gate-fix-take-two"')
  })

  it('trims the oldest lines once the journal grows past the cap', () => {
    writeFileSync(file, `old\n${'x'.repeat(600 * 1024)}\n`)

    journalResume({ active: started, command: 'atlas-dev', directory: '/dev/atlas', clock, file })

    const kept = readFileSync(file, 'utf8')
    expect(kept.length).toBeLessThan(600 * 1024)
    expect(kept).not.toContain('old')
    expect(kept).toContain('atlas-dev --resume "eve-software-factory-architecture"')
  })

  it('survives an unwritable journal location', () => {
    const blocked = join(directory, 'blocked')
    writeFileSync(blocked, 'a file is in the way')

    expect(() =>
      journalResume({
        active: started,
        command: 'atlas-dev',
        directory: '/dev/atlas',
        clock,
        file: join(blocked, 'journal.log'),
      }),
    ).not.toThrow()
  })
})
