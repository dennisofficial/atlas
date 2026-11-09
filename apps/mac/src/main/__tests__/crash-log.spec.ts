import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatLogEntry, runLogged, writeLog } from '../crash-log'

const tempLog = (): string => join(mkdtempSync(join(tmpdir(), 'atlas-log-')), 'main.log')

describe('crash-log', () => {
  test('formats errors with their stack', () => {
    const line = formatLogEntry({ label: 'x', error: new Error('boom'), now: new Date(0) })
    expect(line).toStartWith('1970-01-01T00:00:00.000Z x: Error: boom')
  })
  test('creates parent directories and appends', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'atlas-log-')), 'Logs', 'main.log')
    writeLog({ label: 'a', error: 'one', path })
    writeLog({ label: 'b', error: 'two', path })
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(2)
  })
})

describe('runLogged', () => {
  test('notifies with the failure before rethrowing it, so the app dies loudly', async () => {
    const path = tempLog()
    const seen: { error: unknown; path: string }[] = []
    const failure = new Error('no server on 127.0.0.1')

    await expect(
      runLogged({
        start: async () => {
          throw failure
        },
        notify: (args) => void seen.push(args),
        path,
      }),
    ).rejects.toThrow('no server on 127.0.0.1')

    expect(seen).toEqual([{ error: failure, path }])
    expect(readFileSync(path, 'utf8')).toContain('startup failed: Error: no server on 127.0.0.1')
  })

  test('logs a healthy start and never notifies', async () => {
    const path = tempLog()
    let notified = 0
    await runLogged({ start: async () => undefined, notify: () => void (notified += 1), path })
    expect(notified).toBe(0)
    expect(readFileSync(path, 'utf8')).toContain('started')
  })
})
